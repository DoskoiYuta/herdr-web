import { DECISION_PROMPT_MAX_BYTES, type Decision } from "../../contract/decision";

const encoder = new TextEncoder();
function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** バイト単位で切り詰める。マルチバイト文字の境界を跨がないよう、デコードが
 * 失敗する末尾を 1 バイトずつ削っていく。 */
function truncateToBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  for (let end = maxBytes; end > 0; end--) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, end));
    } catch {
      // 途中でマルチバイト文字を割った: 1 バイト減らして再試行
    }
  }
  return "";
}

/** UUIDv7 の先頭はタイムスタンプで揃うため、末尾を短縮 id として使う（review/ask と同じ規則）。 */
function shortId(id: string): string {
  return id.slice(-8);
}

function titleSuffix(title: string | null): string {
  return title ? `（${title}）` : "";
}

function formatAnswerPart(
  item: Decision["spec"]["items"][number],
  answer: Decision["answer"],
): string {
  const a = answer?.answers[item.id];
  if (!a) return `${item.header || item.id}=(未回答)`;
  const selected = a.selected.length > 0 ? a.selected.join(",") : null;
  const other = a.other ?? null;
  const choice = selected && other ? `${selected}（その他: ${other}）` : (selected ?? other ?? "");
  const note = a.note ? `（note: ${a.note}）` : "";
  return `${item.header || item.id}=${choice}${note}`;
}

/**
 * `hw decision show <id>` に確実に案内できるよう、title を落としてもなお
 * 収まらない分はバイト単位で切り詰める。
 */
function fitToBudget(buildWithTitle: () => string, buildWithoutTitle: () => string): string {
  const withTitle = buildWithTitle();
  if (byteLength(withTitle) <= DECISION_PROMPT_MAX_BYTES) return withTitle;
  const withoutTitle = buildWithoutTitle();
  if (byteLength(withoutTitle) <= DECISION_PROMPT_MAX_BYTES) return withoutTitle;
  return truncateToBytes(withoutTitle, DECISION_PROMPT_MAX_BYTES);
}

/**
 * F13-7: `判断依頼 <短縮 id>（<title>）に回答: <item>=<選択>（note: ...）。全文は
 * hw decision show <id>` の形。2 KiB を超える分は設問を末尾から間引いて逃がす —
 * 削り切れなくても `hw decision show` への案内だけは必ず残す。
 */
export function renderAnsweredPrompt(decision: Decision): string {
  const footer = ` 全文は \`hw decision show ${decision.id}\``;
  const parts = decision.spec.items.map((item) => formatAnswerPart(item, decision.answer));
  const header = (title: string | null) =>
    `判断依頼 ${shortId(decision.id)}${titleSuffix(title)}に回答:`;

  for (let n = parts.length; n >= 1; n--) {
    const body = n === parts.length ? parts.join("; ") : `${parts.slice(0, n).join("; ")}…(省略)`;
    const text = `${header(decision.spec.title)} ${body}。${footer}`;
    if (byteLength(text) <= DECISION_PROMPT_MAX_BYTES) return text;
  }
  return fitToBudget(
    () => `${header(decision.spec.title)}${footer}`,
    () => `${header(null)}${footer}`,
  );
}

/** F13-4: 却下時も待たせ続けないよう agent.prompt で通知する。 */
export function renderDismissedPrompt(decision: Decision): string {
  const header = (title: string | null) =>
    `判断依頼 ${shortId(decision.id)}${titleSuffix(title)}は却下されました。詳細は \`hw decision show ${decision.id}\``;
  return fitToBudget(
    () => header(decision.spec.title),
    () => header(null),
  );
}
