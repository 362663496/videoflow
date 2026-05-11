import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('密码已更新，下次登录请使用新密码。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card provider-card">
      <div>
        <p className="eyebrow">Account</p>
        <h3><KeyRound size={20} /> 修改密码</h3>
      </div>
      <div className="provider-grid">
        <label>当前密码<input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" /></label>
        <label>新密码<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" placeholder="至少 6 位" /></label>
      </div>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="detail-button" onClick={submit} disabled={saving || !currentPassword || newPassword.length < 6}>{saving ? '保存中...' : '更新密码'}</button>
    </section>
  );
}
