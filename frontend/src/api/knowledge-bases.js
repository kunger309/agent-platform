import client from './client';

// ============ 知识库（Knowledge Base）============
export const listKnowledgeBases = () => client.get('/knowledge-bases');
export const getKnowledgeBase = (id) => client.get(`/knowledge-bases/${id}`);
export const createKnowledgeBase = (data) =>
  client.post('/knowledge-bases', data);
export const updateKnowledgeBase = (id, data) =>
  client.patch(`/knowledge-bases/${id}`, data);
export const deleteKnowledgeBase = (id) =>
  client.delete(`/knowledge-bases/${id}`);

// ============ 文档（Document，挂在 KB 下）============
export const listDocuments = (kbId) =>
  client.get(`/knowledge-bases/${kbId}/documents`);
export const getDocument = (kbId, docId) =>
  client.get(`/knowledge-bases/${kbId}/documents/${docId}`);
export const listChunks = (kbId, docId) =>
  client.get(`/knowledge-bases/${kbId}/documents/${docId}/chunks`);

/**
 * 上传文档（单文件，字段名必须为 file，与后端 FileInterceptor('file') 对应）
 * @param {string} kbId
 * @param {File} file 浏览器 File 对象
 */
export const uploadDocument = (kbId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  return client.post(`/knowledge-bases/${kbId}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const retryDocument = (kbId, docId) =>
  client.post(`/knowledge-bases/${kbId}/documents/${docId}/retry`);
export const removeDocument = (kbId, docId) =>
  client.delete(`/knowledge-bases/${kbId}/documents/${docId}`);

// ============ 检索测试 / 实际检索 ============
/**
 * @param {string} kbId
 * @param {string} query
 * @param {{topK?:number, scoreThreshold?:number}} opts
 */
export const retrieve = (kbId, query, opts = {}) =>
  client.post(`/knowledge-bases/${kbId}/retrieve`, { query, ...opts });
