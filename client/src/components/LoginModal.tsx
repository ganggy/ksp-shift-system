import React, { useState } from 'react';
import { Lock, X } from 'lucide-react';
import { api } from '../api';
import type { AuthUser } from '../types';

interface Props {
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export const LoginModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username, password);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="kpi-icon-wrap" style={{ width: 36, height: 36, background: '#f0fdfa', color: '#0f766e' }}>
              <Lock size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 16 }}>เข้าสู่ระบบบุคลากร</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>ยืนยันตัวตนด้วยบัญชีฐานข้อมูลบุคลากร (db_hrd)</div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>ชื่อผู้ใช้ (Username) หรือเลขบัตรประชาชน 13 หลัก</label>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="กรอก Username หรือ CID..."
                required
              />
            </div>
            <div className="field">
              <label>รหัสผ่าน</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="กรอกรหัสผ่าน..."
                required
              />
            </div>
            {error && <div className="alert-strip alert-danger">{error}</div>}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
