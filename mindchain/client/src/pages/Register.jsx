import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Input, Textarea } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';
import { apiErrorMessage, apiFieldErrors } from '../services/api.js';

const EMPTY_PROFILE = { licenseNumber: '', licensingBody: '', specialization: '', yearsOfExperience: '', bio: '' };

// Mirrors the server rules for fast feedback; the server re-validates everything.
function validate(form) {
  const e = {};
  if (form.name.trim().length < 2) e.name = 'Name must be at least 2 characters';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email address';
  if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
  else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) e.password = 'Use letters and numbers';
  if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
  if (form.role === 'therapist') {
    const p = form.therapistProfile;
    if (p.licenseNumber.trim().length < 3) e.licenseNumber = 'License number is required';
    if (p.licensingBody.trim().length < 2) e.licensingBody = 'Licensing body is required';
    if (p.specialization.trim().length < 2) e.specialization = 'Specialization is required';
    const y = Number(p.yearsOfExperience);
    if (p.yearsOfExperience === '' || !Number.isInteger(y) || y < 0 || y > 70) e.yearsOfExperience = 'Enter 0–70';
  }
  return e;
}

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', role: 'patient', therapistProfile: EMPTY_PROFILE });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setP = (k) => (e) => setForm({ ...form, therapistProfile: { ...form.therapistProfile, [k]: e.target.value } });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;

    const payload = { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role };
    if (form.role === 'therapist') {
      payload.therapistProfile = { ...form.therapistProfile, yearsOfExperience: Number(form.therapistProfile.yearsOfExperience) };
    }
    setSubmitting(true);
    try {
      await register(payload);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(apiErrorMessage(err, 'Registration failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join as a patient, or as a therapist pending verification."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Alert type="error">{error}</Alert>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">I am a</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['patient', 'Patient', 'Track my wellbeing'],
              ['therapist', 'Therapist', 'Support my patients'],
            ].map(([value, label, hint]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg p-3 ring-1 transition ${form.role === value ? 'bg-brand-50 ring-2 ring-brand-600' : 'ring-slate-300 hover:bg-slate-50'}`}
              >
                <input type="radio" name="role" value={value} checked={form.role === value} onChange={set('role')} className="sr-only" />
                <span className="block text-sm font-medium text-slate-900">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" value={form.name} onChange={set('name')} invalid={!!errors.name} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={!!errors.email} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="password" error={errors.password} hint="8+ characters, letters and numbers">
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!errors.password} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
            <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} invalid={!!errors.confirm} />
          </Field>
        </div>

        {form.role === 'therapist' && (
          <div className="space-y-4 rounded-xl bg-slate-100/70 p-4">
            <p className="text-xs text-slate-600">
              An administrator reviews these details before therapist features are enabled. Linking a wallet does not
              verify your professional identity.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="License number" htmlFor="licenseNumber" error={errors.licenseNumber}>
                <Input id="licenseNumber" value={form.therapistProfile.licenseNumber} onChange={setP('licenseNumber')} invalid={!!errors.licenseNumber} />
              </Field>
              <Field label="Licensing body" htmlFor="licensingBody" error={errors.licensingBody}>
                <Input id="licensingBody" value={form.therapistProfile.licensingBody} onChange={setP('licensingBody')} invalid={!!errors.licensingBody} />
              </Field>
              <Field label="Specialization" htmlFor="specialization" error={errors.specialization}>
                <Input id="specialization" value={form.therapistProfile.specialization} onChange={setP('specialization')} invalid={!!errors.specialization} />
              </Field>
              <Field label="Years of experience" htmlFor="yearsOfExperience" error={errors.yearsOfExperience}>
                <Input id="yearsOfExperience" type="number" min="0" max="70" value={form.therapistProfile.yearsOfExperience} onChange={setP('yearsOfExperience')} invalid={!!errors.yearsOfExperience} />
              </Field>
            </div>
            <Field label="Short bio (optional)" htmlFor="bio">
              <Textarea id="bio" rows={3} maxLength={1000} value={form.therapistProfile.bio} onChange={setP('bio')} />
            </Field>
          </div>
        )}

        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
