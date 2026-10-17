import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, Check, ChevronDown, Clock3, LogOut, Mail, Plus, Search, Send, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "./api/client";
import { Button } from "./components/Button";
import { ComposeModal } from "./components/ComposeModal";
import { EmailTable } from "./components/EmailTable";
import { Tabs } from "./components/Tabs";
import { Toast, type ToastMessage } from "./components/Toast";
import { useAuth } from "./hooks/useAuth";
import { useEmails } from "./hooks/useEmails";

type View = "scheduled" | "sent";

function LoginPage({ onDemoLogin, demoEnabled }: { onDemoLogin: () => void; demoEnabled: boolean }) {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand-mark"><Mail size={21} /></div>
        <p className="eyebrow">EMAIL AUTOMATION</p>
        <h1>Send with<br /><span>perfect timing.</span></h1>
        <p className="login-copy">Thoughtful outreach, effortlessly scheduled. Keep every email right on time.</p>
        <a className="google-button" href={api.googleLoginUrl}>
          <span className="google-g">G</span> Continue with Google <ArrowRight size={17} />
        </a>
        {demoEnabled && <button className="demo-login" onClick={onDemoLogin}>Or continue with the local demo account</button>}
        <div className="login-points">
          <span><ShieldCheck size={15} /> Private &amp; secure</span>
          <span><Clock3 size={15} /> Always on schedule</span>
        </div>
      </div>
      <div className="login-decoration"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="floating-mail"><Mail size={36} /></div></div>
      <div className="login-footer">MAILFLOW <span>·</span> EMAIL JOB SCHEDULER</div>
    </main>
  );
}

function LoadingPage() {
  return <main className="loading-page"><div className="loading-brand"><Mail size={20} /> mailflow</div><div className="loading-spinner" /></main>;
}

export default function App() {
  const { user, loading: authLoading, error: authError, logout } = useAuth();
  const [view, setView] = useState<View>("scheduled");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackLoading, setSlackLoading] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const { emails, total, totalPages, loading, error, refresh } = useEmails(view, query, page);

  useEffect(() => {
    if (!user) return;
    void api.slackStatus().then((result) => setSlackConnected(result.connected)).catch((cause: unknown) => {
      setToast({ type: "error", text: cause instanceof Error ? cause.message : "Could not load Slack status." });
    });
  }, [user]);

  useEffect(() => {
    setDemoEnabled(import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true");
  }, []);

  useEffect(() => {
    if (error) setToast({ type: "error", text: error });
  }, [error]);

  useEffect(() => {
    if (authError) setToast({ type: "error", text: authError });
  }, [authError]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("slack") === "connected") {
      setSlackConnected(true);
      setToast({ type: "success", text: "Slack connected. Hourly limit alerts are enabled." });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("login") === "failed") setToast({ type: "error", text: "Google sign-in could not be completed." });
  }, []);

  if (authLoading) return <LoadingPage />;
  if (!user) return (
    <>
      <LoginPage
        demoEnabled={demoEnabled}
        onDemoLogin={() => void api.devLogin().then(() => window.location.reload()).catch((cause: unknown) => {
          setToast({ type: "error", text: cause instanceof Error ? cause.message : "Could not sign in to the demo." });
        })}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );

  const handleLogout = async () => {
    try {
      await logout();
    } catch (cause) {
      setToast({ type: "error", text: cause instanceof Error ? cause.message : "Could not log out." });
    }
  };

  const toggleSlack = async () => {
    if (!slackConnected) {
      window.location.assign(api.slackConnectUrl);
      return;
    }
    setSlackLoading(true);
    try {
      await api.disconnectSlack();
      setSlackConnected(false);
      setToast({ type: "success", text: "Slack disconnected." });
    } catch (cause) {
      setToast({ type: "error", text: cause instanceof Error ? cause.message : "Could not disconnect Slack." });
    } finally {
      setSlackLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="sidebar-brand"><span className="brand-mark"><Mail size={19} /></span><span>mailflow</span><span className="brand-tag">SCHEDULER</span></a>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch"><span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="workspace-details"><strong>My workspace</strong><small>Free plan</small></span><ChevronDown size={16} /></button>
        <div className="nav-label">MANAGE</div>
        <button className="sidebar-link active"><Mail size={18} /><span>Emails</span><span className="nav-indicator" /></button>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><div><Sparkles size={15} /> A little tip</div><p>Your best outreach starts with the right timing. Let Mailflow take care of the rest.</p></div>
          <button className="sidebar-link settings-link"><Settings2 size={17} /><span>Settings</span></button>
          <div className="sidebar-account">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{user.name.slice(0, 1).toUpperCase()}</span>}
            <span className="account-details"><strong>{user.name}</strong><small>{user.email}</small></span>
            <button className="logout-button" aria-label="Log out" onClick={() => void handleLogout()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Email campaigns</strong></div>
          <div className="topbar-actions">
            <span className="secure-indicator"><span /> All systems operational</span>
            <button className={`slack-chip ${slackConnected ? "slack-on" : ""}`} onClick={() => void toggleSlack()} disabled={slackLoading}>
              <span className="slack-symbol">✳</span>{slackLoading ? "Updating..." : slackConnected ? "Slack connected" : "Connect Slack"}
              {slackConnected && <Check size={13} />}
            </button>
            <div className="top-user">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar-fallback">{user.name.slice(0, 1).toUpperCase()}</span>}
              <div><strong>{user.name}</strong><small>{user.email}</small></div>
            </div>
          </div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <div className="heading-kicker"><span className="kicker-dot" /> YOUR CAMPAIGN OVERVIEW</div>
              <h1>Emails, on your time.</h1>
              <p>Every message, thoughtfully timed and ready to go.</p>
            </div>
            <Button icon={<Plus size={17} />} onClick={() => setComposeOpen(true)}>Compose new email</Button>
          </div>

          <section className="summary-grid">
            <div className="summary-card summary-primary">
              <div className="summary-icon"><CalendarClock size={18} /></div><span className="summary-label">Scheduled emails</span>
              <strong>{view === "scheduled" ? total : "—"}</strong><small>Queued and in progress</small>
            </div>
            <div className="summary-card">
              <div className="summary-icon summary-icon-mint"><Send size={17} /></div><span className="summary-label">Sent emails</span>
              <strong>{view === "sent" ? total : "—"}</strong><small>Successfully delivered</small>
            </div>
            <div className="summary-card status-card">
              <div className="summary-icon summary-icon-mint"><Check size={17} /></div><span className="summary-label">Delivery status</span>
              <strong className="status-text">Looking good</strong><small>Scheduler is running smoothly</small>
            </div>
          </section>

          <section className="emails-panel">
            <div className="panel-heading">
              <div><h2>Your emails</h2><p>Keep an eye on what's next and what's already out there.</p></div>
              <div className="search-box"><Search size={17} /><input aria-label="Search emails" placeholder="Search emails..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><kbd>⌘ K</kbd></div>
            </div>
            <Tabs
              value={view}
              onChange={(next) => { setView(next); setPage(1); }}
              items={[
                { value: "scheduled", label: "Scheduled Emails", count: view === "scheduled" ? total : undefined },
                { value: "sent", label: "Sent Emails", count: view === "sent" ? total : undefined },
              ]}
            />
            <EmailTable emails={emails} kind={view} loading={loading} error={error} onRetry={refresh} />
            {totalPages > 1 && (
              <div className="table-footer">
                <span>Page {page} of {totalPages} · {total} emails</span>
                <div className="pagination">
                  <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                  <button disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
                </div>
              </div>
            )}
          </section>

          <footer className="page-footer"><span>Made for thoughtful outreach.</span><span>Mailflow Scheduler <span className="footer-dot">·</span> Your time, well spent.</span></footer>
        </section>
      </main>

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} onScheduled={(count) => {
        setToast({ type: "success", text: `${count} email${count === 1 ? "" : "s"} scheduled successfully.` });
        setView("scheduled");
        setPage(1);
        setQuery("");
        refresh();
      }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
