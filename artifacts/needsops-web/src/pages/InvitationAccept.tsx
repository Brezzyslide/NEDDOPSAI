import { useEffect, useState } from "react";
import { useLocation, Redirect } from "wouter";
import { useAuth, Show } from "@clerk/react";
import { useParams } from "wouter";
import { useAuthFetch } from "@/lib/api";

export default function InvitationAccept() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const apiFetch = useAuthFetch();

  useEffect(() => {
    if (!isSignedIn) return;
    if (!token) { setStatus("error"); setMessage("No invitation token found."); return; }
    setStatus("loading");
    apiFetch("/v1/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setStatus("error"); setMessage(d.error.message); return; }
        setStatus("success");
        setTimeout(() => setLocation("/app-home"), 2000);
      })
      .catch(() => { setStatus("error"); setMessage("Network error. Please try again."); });
  }, [token, isSignedIn, apiFetch]);

  return (
    <>
      <Show when="signed-out">
        <div className="min-h-dvh bg-[#0B1829] flex items-center justify-center px-4">
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8 max-w-sm w-full text-center">
            <h1 className="text-xl font-bold text-[#E2E8F0] mb-3">You have been invited</h1>
            <p className="text-[#64748B] text-sm mb-6">Sign in or create an account to accept this invitation.</p>
            <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`} />
          </div>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="min-h-dvh bg-[#0B1829] flex items-center justify-center px-4">
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8 max-w-sm w-full text-center">
            {status === "loading" && (
              <>
                <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-[#E2E8F0]">Accepting invitation...</p>
              </>
            )}
            {status === "success" && (
              <>
                <div className="text-4xl mb-4">✅</div>
                <h1 className="text-xl font-bold text-[#E2E8F0] mb-2">Invitation accepted!</h1>
                <p className="text-[#64748B] text-sm">Redirecting to your dashboard...</p>
              </>
            )}
            {status === "error" && (
              <>
                <div className="text-4xl mb-4">❌</div>
                <h1 className="text-xl font-bold text-[#E2E8F0] mb-2">Could not accept invitation</h1>
                <p className="text-[#64748B] text-sm mb-4">{message}</p>
                <button onClick={() => setLocation("/")} className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg text-sm">Go home</button>
              </>
            )}
          </div>
        </div>
      </Show>
    </>
  );
}
