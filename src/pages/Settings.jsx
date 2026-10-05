import { useState, useEffect } from 'react';
import { Shield, Link2, Mail, Globe, Server, Loader2, AlertCircle } from 'lucide-react';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import NotificationFields from '../components/settings/NotificationFields';
import EmailAutomationPanel from '../components/settings/EmailAutomationPanel';
import WhatsAppEnquiryPanel from '../components/settings/WhatsAppEnquiryPanel';
import { notificationPayload, notificationValues } from '../lib/notifications';

const ROLES = [
  { role: 'Admin / Owner', perms: 'Full access, user management, the only role that can delete records' },
  { role: 'Director', perms: 'Sees everything. Updates order stages and production, logs buyer follow-ups and completes tasks from the Today screen. Cannot edit or delete records.' },
  { role: 'Sales Executive', perms: 'Create/edit clients, send emails, create inquiries' },
  { role: 'Export Manager', perms: 'Edit orders, upload docs, update shipment status' },
  { role: 'Pending', perms: 'No access. Every new sign-in starts here until an Admin / Owner assigns a role.' },
];

const ROLE_OPTIONS = ['Admin / Owner', 'Director', 'Sales Executive', 'Export Manager', 'Pending'];

const CONNECTED_ACCOUNTS = [
  { name: 'LinkedIn Company Page', detail: 'pk.linkedin.com/company/kassamtradingcompany', icon: Link2, status: 'Connected', managedBy: 'Digital Manager' },
  { name: 'Website (WordPress)', detail: 'company website', icon: Globe, status: 'Not Connected', managedBy: 'Digital Manager' },
  { name: 'cPanel Hosting', detail: 'hosting control panel', icon: Server, status: 'Not Connected', managedBy: 'Digital Manager' },
  { name: 'Gmail — Marketing', detail: 'outreach@example.com', icon: Mail, status: 'Not Connected', managedBy: 'Digital Manager' },
  { name: 'Gmail — Info', detail: 'info@example.com', icon: Mail, status: 'Not Connected', managedBy: 'Digital Manager' },
];

function initials(name, email) {
  if (name) return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return '?';
}

export default function Settings() {
  const { profile, user, canEdit } = useAuth();
  const isAdmin = profile?.role === 'Admin / Owner';
  const [tab, setTab] = useState('users');
  const [myAlerts, setMyAlerts] = useState(null);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertsMessage, setAlertsMessage] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: '', alerts: notificationValues() });
  const [saving, setSaving] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'Sales Executive' });
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (error) setError(error.message);
    else setUsers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (myAlerts || !user) return;
    const mine = users.find((u) => u.id === user.id) || profile;
    if (mine) setMyAlerts(notificationValues(mine));
  }, [users, user, profile, myAlerts]);

  async function saveMyAlerts(e) {
    e.preventDefault();
    setAlertsSaving(true);
    setAlertsMessage(null);
    const { error: saveError } = await supabase.from('profiles').update(notificationPayload(myAlerts)).eq('id', user.id);
    setAlertsSaving(false);
    setAlertsMessage(saveError ? { ok: false, text: `Couldn't save: ${saveError.message}` } : { ok: true, text: 'Saved.' });
    if (!saveError) fetchUsers();
  }

  function openEdit(user) {
    setEditingUser(user);
    setEditForm({ full_name: user.full_name || '', role: user.role || 'Sales Executive', alerts: notificationValues(user) });
  }

  async function handleSaveUser(e) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editForm.full_name, role: editForm.role, ...notificationPayload(editForm.alerts) })
      .eq('id', editingUser.id);
    setSaving(false);
    if (error) {
      alert(`Couldn't save: ${error.message}`);
      return;
    }
    setEditingUser(null);
    fetchUsers();
  }

  async function handleInvite() {
    if (!inviteForm.email.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      // Send Supabase magic link invite
      const { error } = await supabase.auth.admin.inviteUserByEmail(inviteForm.email, {
        data: {
          full_name: inviteForm.full_name,
          role: inviteForm.role,
        }
      });

      if (error) {
        // If admin API not available from client, fall back to creating profile entry
        // and letting them sign up via magic link
        const { error: signInError } = await supabase.auth.signInWithOtp({
          email: inviteForm.email,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: inviteForm.full_name, role: inviteForm.role }
          }
        });
        if (signInError) throw new Error(signInError.message);
        setInviteResult({ success: true, message: `Magic link sent to ${inviteForm.email}. They can use it to log in; then set their role here under Users.` });
      } else {
        setInviteResult({ success: true, message: `Invitation sent to ${inviteForm.email}. Once they sign in, set their role here under Users.` });
      }
      setInviteForm({ email: '', full_name: '', role: 'Sales Executive' });
      setTimeout(() => { setInviteModal(false); setInviteResult(null); fetchUsers(); }, 3000);
    } catch (err) {
      setInviteResult({ success: false, message: `Failed to send invite: ${err.message}` });
    }
    setInviting(false);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Manage users, roles, and reference info for connected accounts</p>
        </div>
        {tab === 'users' && isAdmin && (
          <button className="btn btn-primary" onClick={() => { setInviteModal(true); setInviteResult(null); }}>
            <Shield size={15} /> Invite Team Member
          </button>
        )}
      </div>

      <div className="tabs">
        <div className={'tab' + (tab === 'users' ? ' active' : '')} onClick={() => setTab('users')} role="button">Users</div>
        <div className={'tab' + (tab === 'alerts' ? ' active' : '')} onClick={() => setTab('alerts')} role="button">My notifications</div>
        <div className={'tab' + (tab === 'automation' ? ' active' : '')} onClick={() => setTab('automation')} role="button">Email automation</div>
        <div className={'tab' + (tab === 'whatsapp' ? ' active' : '')} onClick={() => setTab('whatsapp')} role="button">WhatsApp enquiries</div>
        <div className={'tab' + (tab === 'roles' ? ' active' : '')} onClick={() => setTab('roles')} role="button">Roles &amp; Permissions</div>
        <div className={'tab' + (tab === 'accounts' ? ' active' : '')} onClick={() => setTab('accounts')} role="button">Connected Accounts</div>
      </div>

      {tab === 'automation' && <EmailAutomationPanel canEdit={canEdit} />}

      {tab === 'whatsapp' && <WhatsAppEnquiryPanel isAdmin={isAdmin} />}

      {tab === 'alerts' && (
        <form className="card" style={{ maxWidth: 560 }} onSubmit={saveMyAlerts}>
          <div className="card-header">
            <div>
              <h3>My notifications</h3>
              <div className="card-header-sub">
                Alerts for new inquiries, buyer messages and overdue replies, plus a morning summary. WhatsApp alerts start once the Meta templates are approved; email works now.
              </div>
            </div>
          </div>
          {myAlerts ? <NotificationFields values={myAlerts} onChange={setMyAlerts} /> : <Loader2 className="spin" size={18} />}
          {alertsMessage && (
            <div className={'alert ' + (alertsMessage.ok ? 'alert-success' : 'alert-danger')} style={{ marginTop: 12 }}>{alertsMessage.text}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={alertsSaving || !myAlerts}>{alertsSaving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      )}

      {tab === 'users' && (
        <div>
          {error && (
            <div className="card" style={{ marginBottom: 16, background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <AlertCircle size={18} color="var(--color-danger)" />
                <div>
                  <strong style={{ color: 'var(--color-danger)' }}>Couldn't load users</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 13 }}>{error}</p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: 12, color: 'var(--color-ink-soft)' }}>Loading users...</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="avatar">{initials(u.full_name, u.email)}</div>
                          <span className="cell-strong">{u.full_name || '(no name set)'}</span>
                        </div>
                      </td>
                      <td>{u.role}</td>
                      <td className="cell-muted">{u.email}</td>
                      <td className="cell-muted">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                      <td>
                        {isAdmin && (
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>Edit</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state"><h4>No users yet</h4><p>Add team members via Supabase Authentication.</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <p className="cell-muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            To add a new team member, create their login in Supabase → Authentication → Users. Their name and role can then be set here.
          </p>
        </div>
      )}

      {tab === 'roles' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Key Permissions</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.role}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="timeline-icon" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                        <Shield />
                      </div>
                      <span className="cell-strong">{r.role}</span>
                    </div>
                  </td>
                  <td>{r.perms}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cell-muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            Note: roles are currently informational. Every logged-in user has the same data access today — permission enforcement per role can be added later if needed.
          </p>
        </div>
      )}

      {tab === 'accounts' && (
        <div>
          <div className="card" style={{ marginBottom: 16, background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)' }}>
            <strong style={{ color: 'var(--color-warning)' }}>⚠ Security Notice</strong>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-ink)' }}>
              Passwords are never stored in this app. This is a reference list of KTC's external accounts —
              actual logins are managed via your company password manager or directly with each provider.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Access Point</th>
                  <th>Status</th>
                  <th>Managed By</th>
                </tr>
              </thead>
              <tbody>
                {CONNECTED_ACCOUNTS.map((a) => (
                  <tr key={a.name}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="timeline-icon" style={{ background: 'var(--color-surface-alt)', color: 'var(--color-ink-soft)' }}>
                          <a.icon />
                        </div>
                        <span className="cell-strong">{a.name}</span>
                      </div>
                    </td>
                    <td className="cell-muted">{a.detail}</td>
                    <td><Badge status={a.status === 'Connected' ? 'Active' : 'Pending'}>{a.status}</Badge></td>
                    <td>{a.managedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!editingUser} onClose={() => setEditingUser(null)} title="Edit User">
        <form onSubmit={handleSaveUser} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
            Full Name
            <input className="select-input" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
            Role
            <select className="select-input" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
            <strong style={{ display: 'block', marginBottom: 10, fontSize: 13.5 }}>Notifications</strong>
            <NotificationFields values={editForm.alerts} onChange={(alerts) => setEditForm({ ...editForm, alerts })} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      {/* Invite Team Member Modal */}
      <Modal open={inviteModal} onClose={() => { setInviteModal(false); setInviteResult(null); }} title="Invite Team Member">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {inviteResult && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: inviteResult.success ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
              color: inviteResult.success ? 'var(--color-success)' : 'var(--color-danger)',
              border: `1px solid ${inviteResult.success ? 'var(--color-success)' : 'var(--color-danger)'}`,
            }}>
              {inviteResult.message}
            </div>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
            Email Address *
            <input
              className="select-input"
              type="email"
              value={inviteForm.email}
              onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
              placeholder="e.g. name@example.com"
              autoFocus
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
            Full Name
            <input
              className="select-input"
              value={inviteForm.full_name}
              onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="e.g. Sultan Ali Paracha"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
            Role
            <select className="select-input" value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', margin: 0 }}>
            They will receive an email with a link to log in and set their password.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => { setInviteModal(false); setInviteResult(null); }}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleInvite}
              disabled={inviting || !inviteForm.email.trim()}
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
