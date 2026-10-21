// Reconcile persisted state without replaying any model calls or file writes.
export function recoverInterruptedTasks(db) {
  const legacyTargets = new Map();
  for (const session of db.sessions || []) {
    const pending = session.pendingClarification;
    if (!pending || pending.jobId) continue;
    // Old records did not have a question/job ID. Match the newest occurrence,
    // not a historical completed task that happened to ask the same question.
    const target = [...(db.jobs || [])].reverse().find(job => job.sessionId === session.id
      && job.type === 'general' && job.status === 'completed' && job.checkpoint?.stage === 'clarification'
      && job.message === pending.request && job.checkpoint?.clarification?.question === pending.question);
    if (target) legacyTargets.set(session.id, target.id);
  }
  for (const job of db.jobs || []) {
    const session = db.sessions?.find(s => s.id === job.sessionId);
    const question = job.checkpoint?.clarification?.question;
    const pending = session?.pendingClarification;
    const legacyWaiting = job.status === 'completed' && job.checkpoint?.stage === 'clarification'
      && pending && (pending.jobId === job.id || !pending.jobId && legacyTargets.get(session.id) === job.id);
    if (job.type === 'general' && question && (job.status === 'waiting_user' || job.status === 'running' || legacyWaiting)) {
      job.status = 'waiting_user';
      job.phase = '等待补充';
      job.needsInput = true;
      job.canResume = false;
      job.checkpoint.stage = 'clarification';
      delete job.completedAt;
      delete job.error;
      if (session) {
        session.queuePaused = true;
        session.pendingClarification = {jobId: job.id, request: job.message, question};
        session.messages ??= [];
        if (!session.messages.some(m => m.jobId === job.id && m.role === 'assistant' && m.text === question))
          session.messages.push({role: 'assistant', text: question, jobId: job.id, files: []});
      }
      continue;
    }
    if (job.type === 'general' && job.status === 'waiting_user' && session) session.queuePaused = true;
  }
  for (const job of [...(db.jobs || []), ...(db.images || [])]) {
    if (!['running', 'queued'].includes(job.status)) continue;
    if (job.type === 'general') {
      const session = db.sessions?.find(s => s.id === job.sessionId);
      if (session) session.queuePaused = true;
      if (job.status === 'queued') continue;
    }
    job.status = 'failed';
    job.phase = '任务已中断';
    job.error = '服务重启，已保留处理结果，请继续处理';
    job.needsInput = false;
    if (job.type === 'general' && job.checkpoint) {
      job.canResume = true;
      job.checkpoint.recovery = {kind: 'recoverable', canResume: true, code: 'SERVICE_RESTARTED'};
      for (const timing of job.checkpoint.timings || []) {
        if (timing.status === 'running') {
          timing.status = 'interrupted';
          timing.errorCode = 'SERVICE_RESTARTED';
        }
      }
    }
  }
}
