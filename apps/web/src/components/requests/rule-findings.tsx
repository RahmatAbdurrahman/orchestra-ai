import type { RuleEvaluationResult } from '@orchestra/domain';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { formatDateTime, formatMoney } from '@/lib/format';

export function RuleFindings({ evaluation }: { evaluation: RuleEvaluationResult }) {
  const errors = evaluation.findings.filter((finding) => finding.severity === 'ERROR');
  const warnings = evaluation.findings.filter((finding) => finding.severity === 'WARNING');
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="rule-findings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          {evaluation.passed ? <CircleCheck className="size-4 text-success" /> : <CircleAlert className="size-4 text-destructive" />}
          Business rules {evaluation.passed ? 'passed' : 'blocked the request'}
        </span>
        <span className="text-xs text-muted-foreground">Evaluated {formatDateTime(evaluation.evaluatedAt)}</span>
      </div>
      {evaluation.totals.totalInBase !== null && evaluation.totals.currency !== evaluation.totals.baseCurrency ? (
        <p className="text-xs text-muted-foreground">
          Converted total: {formatMoney(evaluation.totals.totalInBase, evaluation.totals.baseCurrency)} (simulation rate)
        </p>
      ) : null}
      {errors.length || warnings.length ? (
        <ul className="space-y-1">
          {errors.map((finding, index) => (
            <li key={`e${index}`} className="flex gap-2 text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {finding.message} <span className="font-mono text-[11px] opacity-70">{finding.ruleId}</span>
              </span>
            </li>
          ))}
          {warnings.map((finding, index) => (
            <li key={`w${index}`} className="flex gap-2 text-warning-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {finding.message} <span className="font-mono text-[11px] opacity-70">{finding.ruleId}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No findings.</p>
      )}
      {evaluation.approvalRoute.length ? (
        <p className="text-xs text-muted-foreground">Approval route: {evaluation.approvalRoute.join(' → ')}</p>
      ) : null}
    </div>
  );
}
