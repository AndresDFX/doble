/**
 * Baileys auth state persisted in DynamoDB (one item per signal key).
 *
 * Ported from the sibling `telegram-sender` project. The point: keep the
 * WhatsApp session OFF local disk so it survives restarts / spin-down on hosts
 * with ephemeral filesystems (Render, Fly, etc.) without re-scanning the QR.
 *
 * Returns the same shape as Baileys' `useMultiFileAuthState`
 * (`{ state: { creds, keys }, saveCreds }`) plus a `clearAll()` used on
 * `loggedOut` to wipe the stored session so the next start re-pairs cleanly.
 *
 * DynamoDB table contract: a single string partition key named `id`. Items are
 * namespaced by session id (`<sessionId>::<key>`) so several sessions can share
 * one table. Free-tier friendly (on-demand billing, tiny items).
 */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";

export type DynamoAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Delete every item belonging to this session (creds + keys). */
  clearAll: () => Promise<void>;
};

export async function useDynamoAuthState(
  table: string,
  sessionId: string,
  region: string
): Promise<DynamoAuthState> {
  const ddb = new DynamoDBClient({ region });
  const pk = (k: string) => `${sessionId}::${k}`;

  const read = async (k: string): Promise<any> => {
    const r = await ddb.send(
      new GetItemCommand({ TableName: table, Key: { id: { S: pk(k) } } })
    );
    if (!r.Item || !r.Item.value?.S) return null;
    return JSON.parse(r.Item.value.S, BufferJSON.reviver);
  };

  const write = async (k: string, v: unknown): Promise<void> => {
    await ddb.send(
      new PutItemCommand({
        TableName: table,
        Item: { id: { S: pk(k) }, value: { S: JSON.stringify(v, BufferJSON.replacer) } },
      })
    );
  };

  const remove = async (k: string): Promise<void> => {
    await ddb.send(new DeleteItemCommand({ TableName: table, Key: { id: { S: pk(k) } } }));
  };

  // Wipe all items under this session prefix (creds + every signal key).
  // Used on loggedOut so re-pairing doesn't require manual cleanup.
  const clearAll = async (): Promise<void> => {
    const prefix = `${sessionId}::`;
    let startKey: Record<string, any> | undefined;
    do {
      const r = await ddb.send(
        new ScanCommand({
          TableName: table,
          ProjectionExpression: "id",
          FilterExpression: "begins_with(id, :p)",
          ExpressionAttributeValues: { ":p": { S: prefix } },
          ExclusiveStartKey: startKey,
        })
      );
      for (const it of r.Items ?? []) {
        if (it.id) await ddb.send(new DeleteItemCommand({ TableName: table, Key: { id: it.id } }));
      }
      startKey = r.LastEvaluatedKey;
    } while (startKey);
  };

  const creds: AuthenticationCreds = (await read("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const cat = data[category as keyof SignalDataTypeMap];
            for (const id in cat) {
              const value = (cat as Record<string, unknown>)[id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : remove(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", creds),
    clearAll,
  };
}
