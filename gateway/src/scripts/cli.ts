import { pool } from "../db.js";
import { clampMinutes, nextProactiveAt } from "../domain/proactive-policy.js";

function usage(): never {
  console.error(
    `Usage:
  agent state                              Show current global state
  agent enable | disable                   Toggle global agent
  agent draft on | off                     Toggle draft mode
  agent name <user_name>                   Set how the agent should refer to you
  agent chat list [label]                  List chats (optionally filter by label)
  agent chat enable <chat_id>              Enable agent for a single chat
  agent chat disable <chat_id>             Disable agent for a single chat
  agent chat label <chat_id> <lbl>         Set/override label for a chat
  agent chat proactive <chat_id> on|off    Toggle proactive (scheduled) messages for a chat
  agent chat proactive-range <chat_id> <min> <max>  Set the random interval (minutes)
  agent drafts [limit]                     List pending drafts
  agent drafts approve <draft_id>          Mark draft as approved (NOTE: does not send; v1 sends manually)
`
  );
  process.exit(2);
}

async function main() {
  const [cmd, sub, ...args] = process.argv.slice(2);
  try {
    if (!cmd) usage();

    if (cmd === "state") {
      const { rows } = await pool.query(
        "SELECT enabled, draft_mode, user_name FROM agent_state WHERE id = 1"
      );
      console.log(rows[0]);
      return;
    }

    if (cmd === "enable") {
      await pool.query("UPDATE agent_state SET enabled = TRUE WHERE id = 1");
      console.log("agent enabled");
      return;
    }

    if (cmd === "disable") {
      await pool.query("UPDATE agent_state SET enabled = FALSE WHERE id = 1");
      console.log("agent disabled");
      return;
    }

    if (cmd === "draft") {
      if (sub !== "on" && sub !== "off") usage();
      await pool.query("UPDATE agent_state SET draft_mode = $1 WHERE id = 1", [
        sub === "on",
      ]);
      console.log(`draft_mode = ${sub === "on"}`);
      return;
    }

    if (cmd === "name") {
      const name = sub;
      if (!name) usage();
      await pool.query("UPDATE agent_state SET user_name = $1 WHERE id = 1", [name]);
      console.log(`user_name = ${name}`);
      return;
    }

    if (cmd === "chat") {
      if (sub === "list") {
        const label = args[0];
        const q = label
          ? "SELECT id, name, label, agent_enabled FROM chats WHERE label = $1 ORDER BY name"
          : "SELECT id, name, label, agent_enabled FROM chats ORDER BY name";
        const { rows } = await pool.query(q, label ? [label] : []);
        for (const r of rows) console.log(r);
        return;
      }
      if (sub === "enable" || sub === "disable") {
        const chatId = args[0];
        if (!chatId) usage();
        await pool.query("UPDATE chats SET agent_enabled = $1 WHERE id = $2", [
          sub === "enable",
          chatId,
        ]);
        console.log(`chat ${chatId} agent_enabled = ${sub === "enable"}`);
        return;
      }
      if (sub === "label") {
        const [chatId, label] = args;
        if (!chatId || !label) usage();
        await pool.query("UPDATE chats SET label = $1 WHERE id = $2", [label, chatId]);
        console.log(`chat ${chatId} label = ${label}`);
        return;
      }
      if (sub === "proactive") {
        const [chatId, onoff] = args;
        if (!chatId || (onoff !== "on" && onoff !== "off")) usage();
        if (onoff === "on") {
          // Seed the first schedule from the chat's range (defaults if unset) so
          // the scheduler picks it up — it only fires chats with a next_ts.
          const { rows } = await pool.query<{
            proactive_min_minutes: number;
            proactive_max_minutes: number;
          }>(
            "SELECT proactive_min_minutes, proactive_max_minutes FROM chats WHERE id = $1",
            [chatId]
          );
          const min = rows[0]?.proactive_min_minutes ?? 1;
          const max = rows[0]?.proactive_max_minutes ?? 60;
          const next = nextProactiveAt(new Date(), min, max);
          await pool.query(
            "UPDATE chats SET proactive_enabled = TRUE, proactive_next_ts = $1 WHERE id = $2",
            [next, chatId]
          );
          console.log(`chat ${chatId} proactive = on (próximo ${next.toISOString()})`);
        } else {
          await pool.query(
            "UPDATE chats SET proactive_enabled = FALSE, proactive_next_ts = NULL WHERE id = $1",
            [chatId]
          );
          console.log(`chat ${chatId} proactive = off`);
        }
        return;
      }
      if (sub === "proactive-range") {
        const [chatId, minRaw, maxRaw] = args;
        if (!chatId || minRaw === undefined || maxRaw === undefined) usage();
        let min = clampMinutes(Number(minRaw));
        let max = clampMinutes(Number(maxRaw));
        if (min > max) [min, max] = [max, min];
        await pool.query(
          "UPDATE chats SET proactive_min_minutes = $1, proactive_max_minutes = $2 WHERE id = $3",
          [min, max, chatId]
        );
        console.log(`chat ${chatId} proactive range = ${min}-${max} min`);
        return;
      }
      usage();
    }

    if (cmd === "drafts") {
      if (sub === "approve") {
        const id = args[0];
        if (!id) usage();
        await pool.query(
          "UPDATE drafts SET status = 'approved' WHERE id = $1",
          [Number(id)]
        );
        console.log(`draft ${id} approved`);
        return;
      }
      const limit = sub ? Number(sub) : 20;
      const { rows } = await pool.query(
        `SELECT id, chat_id, content, status, created_at
         FROM drafts WHERE status = 'pending'
         ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      for (const r of rows) console.log(r);
      return;
    }

    usage();
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
