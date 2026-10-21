const activeStatuses = new Set(['running', 'queued', 'waiting_user', 'approval', 'awaiting_approval']);
export function archiveItem(item, jobs, images = [], versions = []) {
  if (!item || item.archivedAt) throw Object.assign(new Error('记录不存在或已删除'), { status: 404 });
  const running = jobs.some(j => (j.sessionId === item.id || j.projectId === item.id) && activeStatuses.has(j.status));
  const versionIds = new Set(versions.filter(v => v.projectId === item.id).map(v => v.id));
  if (running || images.some(j => versionIds.has(j.versionId) && activeStatuses.has(j.status)))
    throw Object.assign(new Error('此记录仍有任务执行，请先停止或等待完成后再删除'), { status: 409 });
  item.archivedAt = new Date().toISOString();
  return { id: item.id, name: item.name, archivedAt: item.archivedAt };
}
export function restoreItem(item) {
  if (!item?.archivedAt) throw Object.assign(new Error('回收站记录不存在'), { status: 404 });
  delete item.archivedAt;
  return { id: item.id, name: item.name };
}
