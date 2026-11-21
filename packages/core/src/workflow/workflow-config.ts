import type { DbClient } from '@orchestra/database';
import { NotFoundError, parseWorkflowConfiguration, type WorkflowConfiguration } from '@orchestra/domain';

/**
 * Loads the configuration snapshot a purchase request was created with.
 * Requests keep the workflow version they started on, so later edits by an
 * administrator never change the rules of in-flight requests.
 */
export async function loadWorkflowConfiguration(
  db: DbClient,
  workflowId: string,
  version: number,
): Promise<WorkflowConfiguration> {
  const row = await db.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId, version } },
    select: { configuration: true },
  });
  if (!row) throw new NotFoundError('Workflow version', `${workflowId}@v${version}`);
  return parseWorkflowConfiguration(row.configuration);
}
