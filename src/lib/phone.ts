// Saudi mobile numbers, stored one way (+9665XXXXXXXX) so WhatsApp and call links always work.

export const COUNTRY_CODE = "+966";

/** Accepts 05x xxx xxxx, 5xxxxxxxx, 9665..., +966 5..., with spaces or dashes. Returns +9665XXXXXXXX or null. */
export function normalizeSaudiMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const m = /^(?:966|0)?(5\d{8})$/.exec(digits);
  return m ? `${COUNTRY_CODE}${m[1]}` : null;
}

/** The part typed after +966, grouped like a Saudi mobile: "50 123 4567". */
export function localDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 9)].filter(Boolean).join(" ");
}

/** "+966501234567" -> "+966 50 123 4567" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+966(\d{2})(\d{3})(\d{4})$/.exec(phone);
  return m ? `+966 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/** Opens a WhatsApp chat with this number, optionally with a message already typed. */
export function whatsappLink(phone: string, text?: string): string {
  const to = phone.replace(/\D/g, "");
  return `https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** WhatsApp message about a task: "Hi Saheeb, about the task "X":" plus a link back to it. */
export function taskMessage(name: string, taskTitle: string, taskId: string): string {
  return `Hi ${name}, about the task "${taskTitle}":\n${window.location.origin}/tasks/${taskId}\n\n`;
}
