import React from 'react';
import { Link } from 'react-router-dom';
import { HardDriveDownload, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';

import type { ContractCoverage, ContractParticipant, ContractRollup } from '@hola/shared';
import { BACKUP_CONTRACT_REF as BACKUP_REF } from '@hola/shared/contracts';

import { coverageRows, unquiescedServices, COVERAGE_META } from '../utils/backup-coverage';
import type { Coverage } from '../utils/backup-coverage';
import { AppIcon } from './ui/AppIcon';
import { StatusBadge } from './ui/StatusBadge';

/**
 * Backup coverage, rendered from the `backup@1` contract rollup (ADR 0004 Phase 4).
 *
 * Hola performs no backups itself — an installed provider app does, and the server
 * quiesces each accepting app around its run. So this is a *view over the installed
 * provider*, not a second engine (the ADR settles #160 in favour of that option),
 * and its whole job is to answer two questions an operator otherwise has to answer
 * by reading manifests: is anything backing this machine up, and which apps does it
 * actually cover?
 *
 * The uncovered list is the point. An app that accepts nothing has never been
 * reviewed for backup, and the failure mode is silent: files captured mid-write
 * that only reveal themselves as unusable during a restore. Showing "not covered"
 * as a plain row — rather than omitting the app — is what makes that visible before
 * the restore rather than during it.
 */

const CoverageBadge: React.FC<{ coverage: Coverage; counts?: ContractCoverage }> = ({ coverage, counts }) => {
  const meta = COVERAGE_META[coverage];
  const title = coverage === 'partial' && counts
    ? `${meta.title} ${counts.targeted} of ${counts.recognised} databases quiesced.`
    : meta.title;
  return (
    <span
      title={title}
      className="inline-flex items-center h-6 px-[9px] rounded-[7px] text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {coverage === 'partial' && counts ? `${meta.label} · ${counts.targeted} of ${counts.recognised}` : meta.label}
    </span>
  );
};

const ProviderPanel: React.FC<{ providers: ContractParticipant[]; providerConflict?: boolean }> = ({ providers, providerConflict }) => {
  if (providers.length === 0) {
    return (
      <div className="px-5 py-10 text-center bg-surface-1 border border-dashed border-border rounded-[14px]">
        <div className="w-[52px] h-[52px] rounded-[14px] bg-warning-weak text-warning flex items-center justify-center mx-auto mb-3.5">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-[17px] font-semibold m-0">No backup provider installed</h2>
        <p className="mt-2 mb-4 text-text-muted text-sm max-w-[520px] mx-auto">
          Nothing is backing this machine up. Backups are performed by a catalog app that
          provides the backup contract (Backrest is the one in the catalog today); Hola
          quiesces every app that accepts the contract around each run.
        </p>
        <Link
          to="/catalog"
          className="inline-flex items-center gap-2 h-10 px-4 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 transition"
        >
          <HardDriveDownload className="w-[18px] h-[18px]" />
          Browse the catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
      <div className="px-[18px] py-3 border-b border-border text-[11.5px] font-semibold text-text-faint uppercase tracking-[0.04em]">
        Backup provider
      </div>
      {providerConflict && (
        <div className="flex items-start gap-[10px] px-[18px] py-3 border-b border-border-soft bg-warning-weak text-warning text-[12.5px]">
          <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
          <span>
            More than one app provides backups. Hola expects one provider per contract; uninstall one of them.
          </span>
        </div>
      )}
      {providers.map(provider => (
        <div key={provider.deploymentId} className="px-[18px] py-[14px] border-b border-border-soft last:border-b-0">
          <div className="flex items-center gap-[11px] flex-wrap">
            <AppIcon name={provider.name} emoji={provider.icon} size={32} />
            <Link
              to={`/deployments/${provider.deploymentId}`}
              className="font-medium text-[13.5px] hover:text-primary transition-colors"
            >
              {provider.name}
            </Link>
            <StatusBadge status={provider.status} />
            <div className="flex-1" />
            {provider.granted ? (
              <span className="inline-flex items-center gap-[6px] text-[12.5px] text-text-muted" title="Granted at install: this app can read every installed app's data, which is what lets it back them up.">
                <ShieldCheck className="w-4 h-4" />
                Reads all app data
              </span>
            ) : (
              <span className="inline-flex items-center gap-[6px] text-[12.5px] text-warning" title="The app declares the provider role but holds no consented grant, so it cannot read other apps' data. Re-install it and approve the grant.">
                <AlertTriangle className="w-4 h-4" />
                Access not granted
              </span>
            )}
          </div>
          {provider.status !== 'running' && (
            <p className="mt-2 mb-0 text-[12.5px] text-warning">
              Installed but not running — no backups are being taken.
            </p>
          )}
        </div>
      ))}
    </div>
  );
};

export const BackupCoverage: React.FC<{
  rollup?: ContractRollup;
  loading?: boolean;
  error?: string | null;
}> = ({ rollup, loading, error }) => {
  if (error) {
    return (
      <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm">
        Couldn’t load backup coverage: {error}
      </div>
    );
  }

  if (!rollup) {
    return <div className="text-text-muted text-sm">{loading ? 'Loading backup coverage…' : null}</div>;
  }

  const rows = coverageRows(rollup);
  // `partial` is deliberately excluded from "covered" — the whole point of the
  // state is that the page must not count a database that may be copied
  // mid-write among the apps it vouches for.
  const covered = rows.filter(r => r.coverage === 'quiesced' || r.coverage === 'as-is').length;
  const partialCount = rows.filter(r => r.coverage === 'partial').length;

  return (
    <div className="flex flex-col gap-[18px]">
      <ProviderPanel providers={rollup.providers} providerConflict={rollup.providerConflict} />

      <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-border flex-wrap">
          <span className="text-[11.5px] font-semibold text-text-faint uppercase tracking-[0.04em]">
            App coverage
          </span>
          {rows.length > 0 && (
            <span className="text-[12.5px] text-text-muted">
              {covered} of {rows.length} installed {rows.length === 1 ? 'app' : 'apps'} covered
              {partialCount > 0 && (
                <span className="text-warning"> · {partialCount} partially</span>
              )}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-text-muted text-sm">No apps installed yet.</div>
        ) : (
          rows.map(({ participant, coverage, isProvider }) => (
            <div
              key={participant.deploymentId}
              className="flex items-center gap-[11px] px-[18px] py-[13px] border-b border-border-soft last:border-b-0 flex-wrap"
            >
              <AppIcon name={participant.name} emoji={participant.icon} size={28} />
              <Link
                to={`/deployments/${participant.deploymentId}`}
                className="font-medium text-[13.5px] hover:text-primary transition-colors"
              >
                {participant.name}
              </Link>
              {isProvider && (
                <span className="inline-flex items-center h-6 px-[9px] rounded-[7px] text-xs font-semibold text-text-muted bg-surface-2">
                  Provider
                </span>
              )}
              <div className="flex-1" />
              <CoverageBadge coverage={coverage} counts={participant.coverage} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/**
 * One app's own backup standing, for its detail page.
 *
 * Deliberately reports two independent facts rather than one verdict: whether this
 * app participates in the contract, and whether anything is installed to act on it.
 * "Covered" while no provider exists is the false reassurance worth avoiding — an
 * app can be perfectly prepared for a backup that nobody is taking.
 */
export const AppBackupCoverage: React.FC<{
  contracts?: { accepts?: string[]; hooks?: string[]; provides?: string[]; coverage?: Record<string, ContractCoverage> };
  rollup?: ContractRollup;
  loading?: boolean;
}> = ({ contracts, rollup, loading }) => {
  const accepts = contracts?.accepts?.includes(BACKUP_REF) ?? false;
  const hooks = contracts?.hooks?.includes(BACKUP_REF) ?? false;
  const isProvider = contracts?.provides?.includes(BACKUP_REF) ?? false;
  const serverCoverage = contracts?.coverage?.[BACKUP_REF];
  const coverage: Coverage = serverCoverage ? serverCoverage.state : accepts ? (hooks ? 'quiesced' : 'as-is') : 'uncovered';
  const meta = COVERAGE_META[coverage];
  const runningProvider = rollup?.providers.find(p => p.status === 'running');
  const missing = serverCoverage && coverage === 'partial' ? unquiescedServices(serverCoverage) : [];

  return (
    <div className="animate-fadein bg-surface-1 border border-border rounded-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-[18px] py-4 border-b border-border-soft flex-wrap">
        <div className="font-semibold text-[15px]">Backups for this app</div>
        <CoverageBadge coverage={coverage} counts={serverCoverage} />
      </div>

      <div className="px-[18px] py-[18px] flex flex-col gap-3 text-sm">
        <p className="m-0 text-text-muted max-w-[620px]">{meta.title}</p>

        {missing.length > 0 && (
          <p className="m-0 text-warning max-w-[620px]">
            {missing.map((svc, i) => (
              <React.Fragment key={svc}>
                {i > 0 && (i === missing.length - 1 ? ' and ' : ', ')}
                <code className="font-mono">{svc}</code>
              </React.Fragment>
            ))}
            {missing.length === 1 ? ' has no pre-backup hook.' : ' have no pre-backup hook.'}
          </p>
        )}

        {isProvider && (
          <p className="m-0 text-text-muted max-w-[620px]">
            This app <strong className="text-text-strong font-semibold">provides</strong> backups for
            everything installed here.
          </p>
        )}

        {loading ? null : rollup && rollup.providers.length === 0 ? (
          <p className="m-0 text-warning">
            No backup provider is installed, so nothing is being backed up — whatever this app
            declares.
          </p>
        ) : runningProvider ? (
          <p className="m-0 text-text-muted">
            Backups are taken by{' '}
            <Link to={`/deployments/${runningProvider.deploymentId}`} className="text-primary hover:underline">
              {runningProvider.name}
            </Link>
            , on its own schedule.
          </p>
        ) : rollup ? (
          <p className="m-0 text-warning">
            The installed backup provider isn’t running, so no backups are being taken.
          </p>
        ) : null}

        <Link to="/backups" className="text-primary hover:underline w-fit">
          See coverage across all apps →
        </Link>
      </div>
    </div>
  );
};
