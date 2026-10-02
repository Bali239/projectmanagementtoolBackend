import { isEmailServiceConfigured, sendAuthActivityEmail } from "./email.service.js";

export async function notifyAuthActivity(user, event) {
  if (!user?.email || !isEmailServiceConfigured()) return;

  try {
    await sendAuthActivityEmail({
      email: user.email,
      name: user.name,
      event,
    });
  } catch (error) {
    console.error(`Account ${event} notification could not be delivered:`, error.message);
  }
}