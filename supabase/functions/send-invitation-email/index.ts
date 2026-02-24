import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

Deno.serve(async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify auth — accept user JWT or service_role key
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if this is a service_role call (used by internal/admin invocations)
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY");
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = serviceRoleKey && token === serviceRoleKey;

  if (!isServiceRole) {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Validate request body
  const { email, teamName, invitedByName, role } = await req.json();
  if (!email) {
    return new Response(JSON.stringify({ error: "email is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Send email via Resend
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "TaskFlow PM <onboarding@resend.dev>",
      to: [email],
      subject: `You've been invited to join ${teamName || "a team"} on TaskFlow PM`,
      html: buildEmailHtml(teamName, invitedByName, role),
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Failed to send email", details: data }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, id: data.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function buildEmailHtml(
  teamName: string | undefined,
  invitedByName: string | undefined,
  role: string | undefined
): string {
  const team = escapeHtml(teamName || "a team");
  const inviter = escapeHtml(invitedByName || "A teammate");
  const memberRole = escapeHtml(role || "member");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">TaskFlow PM</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h2 style="margin:0 0 16px;color:#1c1917;font-size:18px;font-weight:600;">You're invited!</h2>
              <p style="margin:0 0 12px;color:#44403c;font-size:15px;line-height:1.6;">
                <strong>${inviter}</strong> has invited you to join <strong>${team}</strong> as a <strong>${memberRole}</strong>.
              </p>
              <p style="margin:0 0 24px;color:#44403c;font-size:15px;line-height:1.6;">
                Open TaskFlow PM and sign in with this email address to accept the invitation and start collaborating.
              </p>
              <div style="text-align:center;margin:24px 0;">
                <span style="display:inline-block;background:#6366f1;color:#ffffff;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
                  Open TaskFlow PM to get started
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:#fafaf9;border-top:1px solid #e7e5e4;">
              <p style="margin:0;color:#a8a29e;font-size:12px;text-align:center;">
                This invitation was sent by TaskFlow PM. If you didn't expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
