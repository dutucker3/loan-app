import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail(orgName: string, email: string, orgId: string) {
  await resend.emails.send({
    from: 'Lending Platform <onboarding@yourdomain.com>',
    to: email,
    subject: `Welcome to the Lending Platform - ${orgName}`,
    html: `
      <h1>Welcome aboard, ${orgName}!</h1>
      <p>Your organization has been approved.</p>
      <p>Login here: <a href="https://yourapp.com">https://yourapp.com</a></p>
      <p>Organization ID: ${orgId}</p>
    `,
  });
}