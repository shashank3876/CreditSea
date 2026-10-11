'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getGetBorrowerProfileQueryKey, type SalarySlip } from '@workspace/api-client-react';
import { AlertCircle, CheckCircle2, FileText, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  formatFileSize,
  SALARY_SLIP_ACCEPT,
  uploadSalarySlipWithProgress,
  validateSalarySlipClient,
} from '@/lib/salary-slip';

type Props = {
  existing?: SalarySlip | null;
};

type Phase = 'idle' | 'ready' | 'uploading' | 'success' | 'error';

function fmtDate(date?: string | null) {
  return date
    ? new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(date))
    : '—';
}

export function SalarySlipUpload({ existing }: Props) {
  const inputId = useId();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<SalarySlip | null>(existing ?? null);

  useEffect(() => {
    setUploaded(existing ?? null);
  }, [existing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectFile = async (next: File | null) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploadError(null);
    setProgress(0);
    setUploaded(null);

    if (!next) {
      setFile(null);
      setValidationError(null);
      setPhase('idle');
      return;
    }

    const error = await validateSalarySlipClient(next);
    setFile(next);
    if (error) {
      setValidationError(error);
      setPhase('error');
      return;
    }
    setValidationError(null);
    setPhase('ready');
  };

  const startUpload = async (target = file) => {
    if (!target) return;
    const clientError = await validateSalarySlipClient(target);
    if (clientError) {
      setValidationError(clientError);
      setUploadError(null);
      setPhase('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setValidationError(null);
    setUploadError(null);
    setPhase('uploading');
    setProgress(0);

    try {
      const result = await uploadSalarySlipWithProgress(
        target,
        setProgress,
        controller.signal,
      );
      setUploaded(result);
      setFile(null);
      setPhase('success');
      setProgress(100);
      if (inputRef.current) inputRef.current.value = '';
      await qc.invalidateQueries({ queryKey: getGetBorrowerProfileQueryKey() });
    } catch (error) {
      if (controller.signal.aborted) return;
      setUploadError(
        error instanceof Error ? error.message : 'Upload failed. Please try again.',
      );
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const clearSelection = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setValidationError(null);
    setUploadError(null);
    setProgress(0);
    setPhase(uploaded || existing ? 'success' : 'idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const displaySlip = uploaded || existing || null;
  const showProgress = phase === 'uploading';
  const canRetry = Boolean(file) && (phase === 'error' || phase === 'ready');

  return (
    <section className="card card-pad" data-testid="salary-slip-upload">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h2 className="section-title">Income proof</h2>
          <p className="section-caption">
            A recent salary slip helps us verify your income. Files are stored privately and only
            available to authorized reviewers.
          </p>
        </div>
        <FileText size={19} color="#478072" />
      </div>

      <label
        className={`upload-drop${validationError || uploadError ? ' upload-drop-error' : ''}${phase === 'uploading' ? ' upload-drop-busy' : ''}`}
        htmlFor={inputId}
        style={{ display: 'block', marginTop: 18 }}
      >
        <Upload size={18} color="#3b786b" style={{ margin: '0 auto' }} />
        <p>
          {file
            ? file.name
            : displaySlip?.fileName || 'Choose your salary slip'}
        </p>
        <small>
          {file
            ? `${formatFileSize(file.size)} · ${file.type || 'unknown type'}`
            : displaySlip
              ? `Uploaded ${fmtDate(displaySlip.uploadedAt)} · ${formatFileSize(displaySlip.sizeBytes)} · private storage`
              : 'PDF, JPG or PNG · maximum 5 MB · private S3 storage'}
        </small>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={SALARY_SLIP_ACCEPT}
          className="sr-only"
          disabled={phase === 'uploading'}
          onChange={(e) => void selectFile(e.target.files?.[0] || null)}
          data-testid="input-salary-slip"
        />
      </label>

      {file && (
        <div className="upload-meta" data-testid="salary-slip-file-meta">
          <div>
            <div className="upload-meta-name">{file.name}</div>
            <div className="helper">
              {formatFileSize(file.size)}
              {file.type ? ` · ${file.type}` : ''}
            </div>
          </div>
          {phase !== 'uploading' && (
            <button
              type="button"
              className="icon-btn"
              onClick={clearSelection}
              aria-label="Remove selected file"
              data-testid="button-clear-salary-slip"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {showProgress && (
        <div className="upload-progress" data-testid="salary-slip-progress">
          <div className="upload-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="helper" style={{ marginTop: 6 }}>
            Uploading securely… {progress}%
          </div>
        </div>
      )}

      {validationError && (
        <div className="notice error" role="alert" style={{ marginTop: 12 }} data-testid="status-salary-slip-validation">
          <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {validationError}
        </div>
      )}

      {uploadError && (
        <div className="notice error" role="alert" style={{ marginTop: 12 }} data-testid="status-salary-slip-upload-error">
          <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {uploadError}
        </div>
      )}

      {phase === 'success' && displaySlip && !file && (
        <div className="notice success" style={{ marginTop: 12 }} data-testid="status-salary-slip-success">
          <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          “{displaySlip.fileName}” ({formatFileSize(displaySlip.sizeBytes)}) saved to private storage.
        </div>
      )}

      <div className="upload-actions">
        {canRetry && uploadError ? (
          <button
            type="button"
            className="primary-btn"
            style={{ width: '100%' }}
            onClick={() => void startUpload()}
            data-testid="button-retry-salary-slip"
          >
            <RefreshCw size={14} />
            Retry upload
          </button>
        ) : (
          (file || !displaySlip) && (
            <button
              type="button"
              className="secondary-btn"
              style={{ width: '100%' }}
              onClick={() => void startUpload()}
              disabled={!file || phase === 'uploading' || Boolean(validationError)}
              data-testid="button-upload-slip"
            >
              <Upload size={14} />
              {phase === 'uploading' ? `Uploading… ${progress}%` : 'Upload privately'}
            </button>
          )
        )}
        {displaySlip && !file && (
          <button
            type="button"
            className="text-btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => inputRef.current?.click()}
            data-testid="button-replace-salary-slip"
          >
            Replace salary slip
          </button>
        )}
      </div>

      <div className="upload-security-note">
        <ShieldCheck size={13} />
        Validated for type and size, stored under a random private object key, and served only after authorization.
      </div>
    </section>
  );
}
