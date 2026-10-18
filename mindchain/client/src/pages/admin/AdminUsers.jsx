import { useState } from 'react';
import { ErrorState, PageHeader, Pagination } from '../../components/common.jsx';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { Alert, Badge, Button, Card, EmptyState, PageLoader, Select } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { formatDate } from '../../services/format.js';

const VERIFICATION_COLORS = { verified: 'green', pending: 'yellow', rejected: 'red' };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ role: '', accountStatus: '' });
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const params = { page, limit: 15 };
    if (filters.role) params.role = filters.role;
    if (filters.accountStatus) params.accountStatus = filters.accountStatus;
    return (await api.get('/admin/users', { params })).data;
  }, [page, filters.role, filters.accountStatus]);

  const toggle = async () => {
    setSaving(true);
    const next = target.accountStatus === 'active' ? 'suspended' : 'active';
    try {
      await api.patch(`/admin/users/${target.id}/status`, { accountStatus: next });
      setMessage({ type: 'success', text: `${target.name} is now ${next}.` });
      setTarget(null);
      reload();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
      setTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const setFilter = (k) => (e) => {
    setPage(1);
    setFilters({ ...filters, [k]: e.target.value });
  };

  return (
    <div>
      <PageHeader title="Users" description="Manage account status. Suspending an account signs it out everywhere immediately." />
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="w-44">
            <label htmlFor="role" className="mb-1 block text-xs font-medium text-slate-600">Role</label>
            <Select id="role" value={filters.role} onChange={setFilter('role')}>
              <option value="">All roles</option>
              <option value="patient">Patients</option>
              <option value="therapist">Therapists</option>
              <option value="admin">Administrators</option>
            </Select>
          </div>
          <div className="w-44">
            <label htmlFor="status" className="mb-1 block text-xs font-medium text-slate-600">Status</label>
            <Select id="status" value={filters.accountStatus} onChange={setFilter('accountStatus')}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
        </div>
      </Card>
      {message && <Alert type={message.type} className="mb-4">{message.text}</Alert>}
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No users match these filters" />
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Wallet</th>
                  <th scope="col" className="px-4 py-3">Joined</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize">{u.role}</span>
                      {u.role === 'therapist' && <Badge color={VERIFICATION_COLORS[u.verificationStatus]} className="ml-2">{u.verificationStatus}</Badge>}
                    </td>
                    <td className="px-4 py-3"><Badge color={u.accountStatus === 'active' ? 'green' : 'red'}>{u.accountStatus}</Badge></td>
                    <td className="px-4 py-3">{u.walletAddress ? <Badge color="teal">Linked</Badge> : <span className="text-xs text-slate-400">None</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {u.role !== 'admin' && u.id !== me.id && (
                        <Button variant={u.accountStatus === 'active' ? 'secondary' : 'primary'} className="!px-3 !py-1.5" onClick={() => setTarget(u)}>
                          {u.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        onConfirm={toggle}
        loading={saving}
        danger={target?.accountStatus === 'active'}
        title={target?.accountStatus === 'active' ? `Suspend ${target?.name}?` : `Reactivate ${target?.name}?`}
        confirmLabel={target?.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
      >
        {target?.accountStatus === 'active'
          ? 'They will be signed out immediately and cannot log in. A suspended therapist loses access to all patient records.'
          : 'They will be able to sign in again.'}
      </ConfirmDialog>
    </div>
  );
}
