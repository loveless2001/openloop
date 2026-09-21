import type { Database } from "./db/client.js";
import {
  documentEvents,
  documents,
  issueChatMessages,
  issueChatThreads,
  issueEvents,
  issues,
  modelRuns,
  preferenceWeights,
  writingEvaluationRuns,
  writingRubrics,
} from "./db/schema.js";

export function deleteLocalData(database: Database): void {
  database.sqlite.transaction(() => {
    database.orm.delete(issueChatMessages).run();
    database.orm.delete(issueChatThreads).run();
    database.orm.delete(issueEvents).run();
    database.orm.delete(documentEvents).run();
    database.orm.delete(writingEvaluationRuns).run();
    database.orm.delete(issues).run();
    database.orm.delete(modelRuns).run();
    database.orm.delete(documents).run();
    database.orm.delete(writingRubrics).run();
    database.orm.delete(preferenceWeights).run();
  })();
}
