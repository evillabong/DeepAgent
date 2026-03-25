(function () {
    // ===== CONFIGURACIÓN =====
    const DEEPSEEK_API_KEY = 'sk-424dec0e6c084bfe9753c627cb05d20b'; // ⚠️ Reemplazar con tu API key
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

    // ===== ESTADO GLOBAL =====
    let sessionId = null;
    let diffEditor = null;
    let currentFile = null;
    let fileMap = new Map(); // filename -> { original, modified, lineCount, language }
    let modifiedFiles = new Map(); // filename -> modifiedContent
    let fullProjectText = ''; // Texto completo del proyecto para contexto
    let conversationHistory = []; // Historial Q&A con DeepSeek
    let projectContextMessages = []; // Mensajes del proyecto en partes Base64
    let isProcessing = false;
    let projectContextLoaded = false; // Si el proyecto ya fue enviado a DeepSeek
    let isLoadingContext = false; // Si actualmente se está cargando el contexto
    // ===== CONFIGURACIÓN DE CONTEXTO =====
    const CHUNK_SIZE = 50000; // Caracteres Base64 por fragmento
    const MAX_CONVERSATION_HISTORY = 20; // Máximo de mensajes Q&A a incluir por llamada
    // Nuevas variables para exclusión
    let excludedExtensions = new Set();
    let availableExtensions = new Set();
    let isExclusionPanelCollapsed = false;
    
    // Panel state
    let activePanels = {
        tree: true,
        diff: true,
        agent: true
    };
    let isResizing = false;
    let activeResizePanel = null;
    let startX, startWidth;

    // ===== ELEMENTOS DOM =====
    const elements = {
        sessionId: document.getElementById('sessionId'),
        treeContainer: document.getElementById('agentTreeContainer'),
        treeSearch: document.getElementById('agentTreeSearch'),
        currentFileName: document.getElementById('currentFileName'),
        diffEditorContainer: document.getElementById('diffEditorContainer'),
        chatMessages: document.getElementById('agentChatMessages'),
        chatInput: document.getElementById('agentChatInput'),
        sendBtn: document.getElementById('agentSendBtn'),
        saveChangesBtn: document.getElementById('saveChangesBtn'),
        exportSessionBtn: document.getElementById('exportSessionBtn'),
        reloadContextBtn: document.getElementById('reloadContextBtn'),
        refreshMetrics: document.getElementById('refreshMetrics'),
        resetLayout: document.getElementById('resetLayout'),
        acceptChangesBtn: document.getElementById('acceptChangesBtn'),
        rejectChangesBtn: document.getElementById('rejectChangesBtn'),

        // Toggles
        toggleTree: document.getElementById('toggleTree'),
        toggleDiff: document.getElementById('toggleDiff'),
        toggleAgent: document.getElementById('toggleAgent'),

        // Panels
        treePanel: document.getElementById('treePanel'),
        diffPanel: document.getElementById('diffPanel'),
        agentPanel: document.getElementById('agentChatPanel'),

        // Tabs
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabProject: document.getElementById('tab-project'),
        tabMetrics: document.getElementById('tab-metrics'),

        // Metrics (en tabs)
        metricTotalFiles: document.getElementById('metricTotalFiles'),
        metricProcessedFiles: document.getElementById('metricProcessedFiles'),
        metricOriginalLines: document.getElementById('metricOriginalLines'),
        metricModifiedLines: document.getElementById('metricModifiedLines'),
        metricChanges: document.getElementById('metricChanges'),
        metricTokens: document.getElementById('metricTokens'),
        fileMetricsBody: document.getElementById('fileMetricsBody'),

        // Summary (tab proyecto)
        summaryTotalFiles: document.getElementById('summaryTotalFiles'),
        summaryModifiedFiles: document.getElementById('summaryModifiedFiles'),
        summaryTotalLines: document.getElementById('summaryTotalLines'),

        // Progress
        progressIndicator: document.getElementById('progressIndicator'),
        progressMessage: document.getElementById('progressMessage'),
        progressBarFill: document.getElementById('progressBarFill'),
        progressPercentage: document.getElementById('progressPercentage')
    };

    // ===== MAPA DE LENGUAJES =====
    const languageMap = {
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'py': 'python',
        'java': 'java',
        'cs': 'csharp',
        'cpp': 'cpp',
        'c': 'c',
        'html': 'html',
        'htm': 'html',
        'css': 'css',
        'json': 'json',
        'xml': 'xml',
        'md': 'markdown',
        'sql': 'sql',
        'php': 'php',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust'
    };

    // ===== UTILIDADES =====
    function showProgress(message, showBar = true) {
        elements.progressMessage.textContent = message;
        elements.progressBarFill.style.width = '0%';
        elements.progressPercentage.textContent = '0%';
        elements.progressIndicator.style.display = 'flex';
    }

    function updateProgress(percent, message) {
        elements.progressBarFill.style.width = `${percent}%`;
        elements.progressPercentage.textContent = `${Math.round(percent)}%`;
        if (message) elements.progressMessage.textContent = message;
    }

    function hideProgress() {
        elements.progressIndicator.style.display = 'none';
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getLanguageFromFilename(filename) {
        const parts = filename.split('/');
        const basename = parts[parts.length - 1];
        const ext = basename.split('.').pop().toLowerCase();
        return languageMap[ext] || 'plaintext';
    }

    // ===== ESCAPAR CORRECTAMENTE PARA JSON (SOLUCIÓN AL ERROR) =====
    function escapeObjectForJSON(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        return JSON.parse(JSON.stringify(obj, (key, value) => {
            if (typeof value === 'string') {
                // Escapar caracteres especiales en strings
                return value
                    .replace(/\\/g, '\\\\')    // Escapar backslash
                    .replace(/"/g, '\\"')       // Escapar comillas dobles
                    .replace(/\n/g, '\\n')       // Escapar nuevas líneas
                    .replace(/\r/g, '\\r')       // Escapar retornos de carro
                    .replace(/\t/g, '\\t')       // Escapar tabs
                    .replace(/\f/g, '\\f')       // Escapar form feeds
                    .replace(/\b/g, '\\b');      // Escapar backspaces
            }
            return value;
        }));
    }

    // ===== FORMATO OFICIAL DE DEEPSEEK PARA ARCHIVOS =====
    function formatFileForDeepSeek(filename, content) {
        return `[file name]: ${filename}
[file content begin]
${content}
[file content end]`;
    }

    // ===== BASE64 ENCODE/DECODE (Unicode-safe) =====
    function toBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function fromBase64(b64) {
        try {
            return decodeURIComponent(escape(atob(b64)));
        } catch (e) {
            console.warn('Base64 decode fallback (non-Unicode content):', e);
            return atob(b64); // fallback para contenido no-Unicode
        }
    }

    // ===== SYSTEM PROMPT CON FORMATO XML ESTANDARIZADO =====
    const RESPONSE_SYSTEM_PROMPT = `Eres un asistente experto en análisis y edición de código. El proyecto completo fue cargado en esta conversación en partes Base64 (UTF-8).

SIEMPRE responde usando el siguiente formato XML estándar:

<respuesta>
  <analisis>Tu análisis o respuesta al usuario</analisis>
  <cambios>
    <!-- Incluir SOLO si hay archivos a modificar, crear o eliminar -->
    <archivo nombre="ruta/del/archivo.ext" accion="modificar">
      <contenido_base64>BASE64_DEL_NUEVO_CONTENIDO_EN_UTF8</contenido_base64>
    </archivo>
    <archivo nombre="ruta/archivo_nuevo.ext" accion="crear">
      <contenido_base64>BASE64_DEL_CONTENIDO</contenido_base64>
    </archivo>
    <archivo nombre="ruta/a_eliminar.ext" accion="eliminar"/>
  </cambios>
  <instrucciones>Instrucciones adicionales para el usuario (opcional)</instrucciones>
</respuesta>

Reglas estrictas:
- SIEMPRE usa esta estructura XML, nunca respondas fuera de ella.
- Si no hay cambios de código, omite el bloque <cambios> completo.
- El contenido de archivos SIEMPRE en Base64 codificado en UTF-8.
- Sé técnico y preciso en <analisis>.
- Puedes referirte a archivos específicos por su nombre del proyecto.
- Nunca respondas fuera del bloque <respuesta>.`;


    function getSessionIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('session');
    }

    // ===== INICIALIZAR TABS =====
    function initTabs() {
        elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                elements.tabBtns.forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                const tabId = btn.dataset.tab;
                document.getElementById(`tab-${tabId}`).classList.add('active');
            });
        });
    }

    // ===== CARGAR DATOS DE LA SESIÓN =====
    async function loadSessionData() {
        sessionId = getSessionIdFromUrl();

        if (!sessionId) {
            sessionId = await DeepAgentDB.getMeta('currentSession');
        }

        if (!sessionId) {
            elements.sessionId.textContent = 'No hay sesión activa';
            addChatMessage('system', '❌ No hay sesión activa. Vuelve a la página principal y procesa un ZIP.');
            return false;
        }

        elements.sessionId.textContent = sessionId;

        // Cargar datos de la sesión desde IndexedDB
        const sessionRecord = await DeepAgentDB.loadSession(sessionId);
        if (!sessionRecord) {
            addChatMessage('system', '❌ No se encontraron datos para esta sesión');
            return false;
        }

        try {
            // Guardar el texto completo del proyecto
            fullProjectText = sessionRecord.content;

            // Parsear los archivos individuales
            parseProjectFiles(sessionRecord.content);

            // Cargar cambios guardados previamente si existen
            const savedChanges = await DeepAgentDB.loadChanges(sessionId);
            if (savedChanges) {
                savedChanges.forEach(change => {
                    if (fileMap.has(change.filename)) {
                        fileMap.get(change.filename).modified = change.content;
                        modifiedFiles.set(change.filename, change.content);
                    }
                });
            }

            const sizeInfo = formatBytes(fullProjectText.length);
            addChatMessage('agent', `✅ Sesión cargada: ${fileMap.size} archivos encontrados (${sizeInfo}). Iniciando carga de contexto...`);

            return true;

        } catch (error) {
            console.error('Error cargando sesión:', error);
            addChatMessage('system', '❌ Error al cargar los datos de la sesión');
            return false;
        }
    }

    // ===== PARSEAR ARCHIVOS DEL PROYECTO =====
    function parseProjectFiles(content) {
        // Buscar archivos en el formato generado por la página principal
        const fileRegex = /📄 ARCHIVO: (.*?)\n[─]+\n([\s\S]*?)(?=\n━━━━━━━━━━━━━━━━━|$)/g;
        let match;
        let fileCount = 0;

        while ((match = fileRegex.exec(content)) !== null) {
            const filename = match[1].trim();
            const fileContent = match[2].trim();

            if (filename && fileContent) {
                fileMap.set(filename, {
                    original: fileContent,
                    modified: fileContent,
                    lineCount: fileContent.split('\n').length,
                    language: getLanguageFromFilename(filename)
                });
                fileCount++;
            }
        }

        console.log(`Parseados ${fileCount} archivos`);

        // Si no encuentra con el regex anterior, intentar con un formato más simple
        if (fileCount === 0) {
            // Fallback: buscar líneas que parezcan archivos
            const lines = content.split('\n');
            let currentFile = null;
            let currentContent = [];

            for (const line of lines) {
                if (line.startsWith('📄 ARCHIVO:')) {
                    // Guardar archivo anterior
                    if (currentFile && currentContent.length > 0) {
                        const fileContent = currentContent.join('\n');
                        fileMap.set(currentFile, {
                            original: fileContent,
                            modified: fileContent,
                            lineCount: currentContent.length,
                            language: getLanguageFromFilename(currentFile)
                        });
                    }

                    // Nuevo archivo
                    currentFile = line.replace('📄 ARCHIVO:', '').trim();
                    currentContent = [];
                } else if (currentFile && !line.startsWith('━━━') && !line.startsWith('───')) {
                    currentContent.push(line);
                }
            }

            // Guardar último archivo
            if (currentFile && currentContent.length > 0) {
                const fileContent = currentContent.join('\n');
                fileMap.set(currentFile, {
                    original: fileContent,
                    modified: fileContent,
                    lineCount: currentContent.length,
                    language: getLanguageFromFilename(currentFile)
                });
            }
        }

        // Construir árbol si hay archivos
        if (fileMap.size > 0) {
            buildTree(Array.from(fileMap.keys()));
            updateMetrics();
        } else {
            console.error('No se pudieron parsear archivos del contenido');
            addChatMessage('system', '⚠️ No se encontraron archivos en el proyecto');
        }
    }

    // ===== CONSTRUIR ÁRBOL JERÁRQUICO =====
    function buildTree(paths) {
        const root = { name: 'root', type: 'folder', children: [], fullPath: '' };

        for (const path of paths) {
            const parts = path.split('/');
            let current = root;
            let accumulated = '';

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!part) continue;

                accumulated = accumulated ? accumulated + '/' + part : part;
                const isFile = (i === parts.length - 1);

                let child = current.children.find(c => c.name === part && c.type === (isFile ? 'file' : 'folder'));

                if (!child) {
                    child = {
                        name: part,
                        type: isFile ? 'file' : 'folder',
                        fullPath: accumulated,
                        children: isFile ? null : []
                    };
                    current.children.push(child);
                }

                if (!isFile) current = child;
            }
        }

        renderTree(root, elements.treeContainer);
    }

    // ===== RENDERIZAR ÁRBOL =====
    function renderTree(node, container) {
        container.innerHTML = '';

        function render(node, container) {
            if (!node.children) return;

            node.children.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            for (const child of node.children) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'tree-item';
                if (child.fullPath === currentFile) itemDiv.classList.add('selected');

                const icon = child.type === 'folder' ? '📁' : '📄';
                itemDiv.innerHTML = `
                    <span class="folder-icon">${icon}</span>
                    <span class="file-name" title="${child.fullPath}">${child.name}</span>
                `;

                itemDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (child.type === 'file') {
                        document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
                        itemDiv.classList.add('selected');
                        selectFile(child.fullPath);
                    } else {
                        const childrenDiv = itemDiv.nextSibling;
                        if (childrenDiv && childrenDiv.classList.contains('tree-children')) {
                            childrenDiv.style.display = childrenDiv.style.display === 'none' ? 'block' : 'none';
                        }
                    }
                });

                container.appendChild(itemDiv);

                if (child.type === 'folder' && child.children) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'tree-children';
                    render(child, childrenContainer);
                    container.appendChild(childrenContainer);
                }
            }
        }

        render(node, container);
    }

    // ===== FILTRAR ÁRBOL =====
    function filterTree() {
        const filterText = elements.treeSearch.value.toLowerCase();
        const items = document.querySelectorAll('#agentTreeContainer .tree-item');

        items.forEach(item => {
            const fileName = item.querySelector('.file-name').textContent.toLowerCase();
            const shouldShow = !filterText || fileName.includes(filterText);
            item.style.display = shouldShow ? 'flex' : 'none';
        });
    }

    // ===== SELECCIONAR ARCHIVO =====
    function selectFile(filename) {
        const fileData = fileMap.get(filename);
        if (!fileData) return;

        currentFile = filename;
        elements.currentFileName.textContent = filename;

        // Actualizar Diff Editor
        if (diffEditor) {
            const originalModel = monaco.editor.createModel(fileData.original, fileData.language);
            const modifiedModel = monaco.editor.createModel(
                modifiedFiles.get(filename) || fileData.original,
                fileData.language
            );

            diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel
            });
        }
    }

    // ===== INICIALIZAR DIFF EDITOR =====
    function initDiffEditor() {
        require.config({
            paths: {
                vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.34.1/min/vs'
            }
        });

        require(['vs/editor/editor.main'], function () {
            diffEditor = monaco.editor.createDiffEditor(elements.diffEditorContainer, {
                renderSideBySide: true,
                readOnly: false,
                automaticLayout: true,
                minimap: { enabled: true },
                fontSize: 13,
                fontFamily: 'Fira Code, Consolas, monospace',
                enableSplitViewResizing: true,
                originalEditable: false,
                renderIndicators: true,
                renderMarginRevertIcon: true
            });

            // Detectar cambios en el lado modificado
            diffEditor.onDidUpdateDiff(() => {
                if (currentFile) {
                    const modifiedModel = diffEditor.getModifiedEditor().getModel();
                    if (modifiedModel) {
                        const newContent = modifiedModel.getValue();
                        const fileData = fileMap.get(currentFile);

                        if (fileData) {
                            fileData.modified = newContent;
                            modifiedFiles.set(currentFile, newContent);
                            updateMetrics();
                        }
                    }
                }
            });
        });
    }

    // ===== ACTUALIZAR MÉTRICAS =====
    function updateMetrics() {
        const totalFiles = fileMap.size;
        const processedFiles = modifiedFiles.size;

        let originalLines = 0;
        let modifiedLines = 0;
        let changes = 0;
        let totalLines = 0;

        let tableHtml = '';

        for (const [filename, data] of fileMap.entries()) {
            const fileLines = data.original.split('\n').length;
            originalLines += fileLines;
            totalLines += fileLines;

            const modified = modifiedFiles.has(filename);
            const modifiedContent = modified ? modifiedFiles.get(filename) : data.original;
            const modifiedFileLines = modifiedContent.split('\n').length;

            if (modified) {
                modifiedLines += modifiedFileLines;
                changes++;
            }

            const status = modified ? 'modificado' : 'original';
            const statusClass = modified ? 'modified' : 'original';

            tableHtml += `<tr>
                <td>${filename.split('/').pop()}</td>
                <td>${fileLines}</td>
                <td>${modified ? modifiedFileLines : '-'}</td>
                <td>${modified ? (modifiedFileLines - fileLines) : '-'}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
            </tr>`;
        }

        // Calcular tokens estimados (aprox 4 caracteres por token)
        let totalChars = 0;
        for (const data of fileMap.values()) {
            totalChars += data.original.length;
        }
        const estimatedTokens = Math.round(totalChars / 4);

        // Actualizar métricas en tab de métricas
        if (elements.metricTotalFiles) elements.metricTotalFiles.textContent = totalFiles;
        if (elements.metricProcessedFiles) elements.metricProcessedFiles.textContent = processedFiles;
        if (elements.metricOriginalLines) elements.metricOriginalLines.textContent = originalLines.toLocaleString();
        if (elements.metricModifiedLines) elements.metricModifiedLines.textContent = modifiedLines.toLocaleString();
        if (elements.metricChanges) elements.metricChanges.textContent = changes;
        if (elements.metricTokens) elements.metricTokens.textContent = estimatedTokens.toLocaleString();

        // Actualizar resumen en tab de proyecto
        if (elements.summaryTotalFiles) elements.summaryTotalFiles.textContent = totalFiles;
        if (elements.summaryModifiedFiles) elements.summaryModifiedFiles.textContent = processedFiles;
        if (elements.summaryTotalLines) elements.summaryTotalLines.textContent = totalLines.toLocaleString();

        if (elements.fileMetricsBody) elements.fileMetricsBody.innerHTML = tableHtml;
    }

    // ===== AGREGAR MENSAJE AL CHAT =====
    function addChatMessage(type, content, isCode = false) {
        const messageDiv = document.createElement('div');

        if (isCode) {
            messageDiv.className = 'message code';
            messageDiv.textContent = content;
        } else {
            messageDiv.className = `message ${type}`;
            messageDiv.textContent = content;
        }

        elements.chatMessages.appendChild(messageDiv);
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    // ===== LLAMAR A DEEPSEEK API CON EL PROYECTO COMPLETO =====
    async function callDeepSeekAPI(messages) {
        if (DEEPSEEK_API_KEY === 'tu-api-key-aqui') {
            addChatMessage('system', '⚠️ Configura tu API key de DeepSeek en el archivo agent.js');
            return simulateDeepSeekResponse(messages);
        }

        try {
            // Crear una copia limpia de los mensajes
            const cleanMessages = messages.map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string' ?
                    msg.content.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') :
                    String(msg.content)
            }));

            const response = await fetch(DEEPSEEK_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'X-Session-ID': sessionId 
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: cleanMessages,
                    temperature: 0.6, // Temperatura recomendada por DeepSeek [citation:10]
                    max_tokens: 4096,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error Response:', errorText);

                // Intentar parsear el error
                try {
                    const errorJson = JSON.parse(errorText);
                    throw new Error(`API Error: ${errorJson.error?.message || response.status}`);
                } catch {
                    throw new Error(`API Error: ${response.status} - ${errorText.substring(0, 200)}`);
                }
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            console.error('Error calling DeepSeek:', error);
            throw error;
        }
    }

    // ===== SIMULAR RESPUESTA (para desarrollo) =====
    function simulateDeepSeekResponse(messages) {
        const lastMessage = messages[messages.length - 1].content;

        if (lastMessage.toLowerCase().includes('mejora')) {
            return `He analizado el código y tengo algunas sugerencias de mejora:

\`\`\`javascript
// Versión mejorada con manejo de errores
async function processData(data) {
    try {
        const result = await fetch('/api/process', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return await result.json();
    } catch (error) {
        console.error('Error processing data:', error);
        throw new Error('Failed to process data');
    }
}
\`\`\`

Esta versión incluye:
- Manejo de errores con try/catch
- Logging para debugging
- Mejor legibilidad`;
        }

        return "Entiendo tu pregunta. Basado en el código que veo, puedo sugerir algunas optimizaciones. ¿Hay algún archivo específico en el que quieras que me enfoque?";
    }

    // ===== INICIALIZAR CONTEXTO DEL PROYECTO EN PARTES BASE64 =====
    async function initProjectContext() {
        if (isLoadingContext || fileMap.size === 0) {
            if (fileMap.size === 0) {
                addChatMessage('system', '⚠️ No hay archivos en el proyecto para cargar en el contexto.');
            }
            return;
        }
        isLoadingContext = true;
        projectContextLoaded = false;
        projectContextMessages = [];

        // Deshabilitar el chat durante la carga
        elements.chatInput.disabled = true;
        elements.sendBtn.disabled = true;
        if (elements.reloadContextBtn) elements.reloadContextBtn.disabled = true;

        try {
            // Construir texto completo del proyecto usando el formato DeepSeek
            const allFilesText = Array.from(fileMap.entries())
                .map(([filename, data]) => formatFileForDeepSeek(filename, data.original))
                .join('\n\n');

            // Codificar en Base64 (Unicode-safe)
            const b64Content = toBase64(allFilesText);
            const totalParts = Math.ceil(b64Content.length / CHUNK_SIZE);

            addChatMessage('system', `📤 Enviando proyecto a DeepSeek en ${totalParts} parte(s) Base64 (${formatBytes(b64Content.length)} codificados)...`);
            showProgress(`Inicializando contexto (0/${totalParts})...`);

            // --- Mensaje INIT: establecer el protocolo ---
            const initMessage = `PROYECTO_INIT
session_id: ${sessionId}
total_parts: ${totalParts}
encoding: base64
Vas a recibir el código fuente completo de un proyecto de software en ${totalParts} parte(s) codificadas en Base64 (UTF-8).
Espera a recibir TODAS las partes antes de procesarlas (PROYECTO_PART_1 hasta PROYECTO_PART_${totalParts}).

Protocolo de respuesta durante la carga:
- Cuando recibas cada parte intermedia responde ÚNICAMENTE con:
  <respuesta><estado>PARTE_RECIBIDA</estado><partes_recibidas>N</partes_recibidas><partes_totales>${totalParts}</partes_totales></respuesta>
- Cuando recibas la ÚLTIMA parte (${totalParts}/${totalParts}), decodifica el Base64, analiza el proyecto y responde con:
  <respuesta><estado>PROYECTO_LISTO</estado><archivos_cargados>N</archivos_cargados><resumen>Breve descripción del proyecto</resumen></respuesta>

A partir de ese momento, en TODAS tus respuestas usa el formato XML estándar indicado en el system prompt.`;

            projectContextMessages.push({ role: 'user', content: initMessage });
            const initReply = await callDeepSeekAPI(projectContextMessages);
            projectContextMessages.push({ role: 'assistant', content: initReply });

            updateProgress(Math.round(1 / (totalParts + 1) * 100), `Protocolo aceptado, enviando partes...`);

            // --- Enviar cada fragmento Base64 ---
            for (let i = 0; i < totalParts; i++) {
                const partNum = i + 1;
                const chunk = b64Content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

                updateProgress(
                    Math.round((partNum / totalParts) * 100),
                    `Enviando parte ${partNum}/${totalParts}...`
                );

                const partMessage = `PROYECTO_PART_${partNum}_DE_${totalParts}\n${chunk}`;
                projectContextMessages.push({ role: 'user', content: partMessage });
                const partReply = await callDeepSeekAPI(projectContextMessages);
                projectContextMessages.push({ role: 'assistant', content: partReply });

                addChatMessage('system', `📦 Parte ${partNum}/${totalParts} confirmada por DeepSeek`);
            }

            hideProgress();
            projectContextLoaded = true;

            // Interpretar la respuesta final (PROYECTO_LISTO)
            const finalReply = projectContextMessages[projectContextMessages.length - 1].content;
            const parsedInit = parseStandardResponse(finalReply, true);
            if (parsedInit && parsedInit.estado === 'PROYECTO_LISTO') {
                const resumen = parsedInit.resumen || `${fileMap.size} archivos cargados`;
                addChatMessage('agent', `✅ Proyecto cargado en DeepSeek: ${resumen}`);
            } else {
                addChatMessage('agent', `✅ Proyecto enviado en ${totalParts} parte(s). ¡Puedes empezar a consultar!`);
            }

        } catch (error) {
            hideProgress();
            projectContextLoaded = false;
            addChatMessage('system', `❌ Error al cargar el contexto: ${error.message}. Usa el botón "Recargar contexto" para reintentar.`);
            console.error('Error in initProjectContext:', error);
        } finally {
            isLoadingContext = false;
            elements.chatInput.disabled = false;
            elements.sendBtn.disabled = false;
            if (elements.reloadContextBtn) elements.reloadContextBtn.disabled = false;
        }
    }

    // ===== PARSEAR RESPUESTA XML ESTANDARIZADA =====
    function parseStandardResponse(responseText, isInitPhase = false) {
        try {
            const xmlMatch = responseText.match(/<respuesta>([\s\S]*?)<\/respuesta>/);
            if (!xmlMatch) return null;

            const xmlContent = xmlMatch[1];

            const getTag = (tag) => {
                const m = xmlContent.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
                return m ? m[1].trim() : null;
            };

            const result = {
                estado: getTag('estado'),
                analisis: getTag('analisis'),
                instrucciones: getTag('instrucciones'),
                resumen: getTag('resumen'),
                archivosCargados: getTag('archivos_cargados'),
                cambios: []
            };

            if (isInitPhase) return result;

            // Parsear archivos a modificar/crear/eliminar
            // Matches self-closing (<archivo nombre="x" accion="y"/>) or
            // content-bearing (<archivo nombre="x" accion="y">...</archivo>) tags.
            const archivoRegex = /<archivo\s+nombre="([^"]+)"\s+accion="([^"]+)"(?:\s*\/>|>([\s\S]*?)<\/archivo>)/g;
            let match;
            while ((match = archivoRegex.exec(xmlContent)) !== null) {
                const nombre = match[1];
                const accion = match[2];
                const innerContent = match[3] || '';
                const b64Match = innerContent.match(/<contenido_base64>([\s\S]*?)<\/contenido_base64>/);
                const contenidoB64 = b64Match ? b64Match[1].trim() : null;
                result.cambios.push({
                    nombre,
                    accion,
                    contenido: contenidoB64 ? fromBase64(contenidoB64) : null
                });
            }

            return result;
        } catch (error) {
            console.error('Error parsing standard response:', error);
            return null;
        }
    }

    // ===== APLICAR CAMBIOS DE ARCHIVOS DESDE RESPUESTA XML =====
    function applyParsedChanges(cambios) {
        if (!cambios || cambios.length === 0) return 0;
        let applied = 0;
        for (const cambio of cambios) {
            const { nombre, accion, contenido } = cambio;
            if (accion === 'eliminar') {
                fileMap.delete(nombre);
                modifiedFiles.delete(nombre);
                applied++;
                addChatMessage('system', `🗑️ Archivo eliminado: ${nombre}`);
                buildTree(Array.from(fileMap.keys()));
                continue;
            }
            if ((accion === 'modificar' || accion === 'crear') && contenido !== null) {
                if (accion === 'crear' && !fileMap.has(nombre)) {
                    fileMap.set(nombre, {
                        original: contenido,
                        modified: contenido,
                        lineCount: contenido.split('\n').length,
                        language: getLanguageFromFilename(nombre)
                    });
                    buildTree(Array.from(fileMap.keys()));
                }
                const fileData = fileMap.get(nombre);
                if (fileData) {
                    fileData.modified = contenido;
                    modifiedFiles.set(nombre, contenido);
                    if (currentFile === nombre && diffEditor) {
                        const modifiedModel = monaco.editor.createModel(contenido, fileData.language);
                        diffEditor.getModifiedEditor().setModel(modifiedModel);
                    }
                    applied++;
                    addChatMessage('system', `✏️ ${accion === 'crear' ? 'Creado' : 'Modificado'}: ${nombre}`);
                }
            }
        }
        if (applied > 0) updateMetrics();
        return applied;
    }

    // ===== ENVIAR MENSAJE AL AGENTE =====
    async function sendMessage() {
        // isLoadingContext: context is currently being loaded (sequential chunk API calls in progress)
        // !projectContextLoaded: context load failed or hasn't started yet
        // Both block sending since the project context is not available.
        if (isProcessing || isLoadingContext) return;

        if (!projectContextLoaded) {
            addChatMessage('system', '⏳ El contexto del proyecto aún se está cargando. Por favor espera...');
            return;
        }

        const message = elements.chatInput.value.trim();
        if (!message) return;

        addChatMessage('user', message);
        elements.chatInput.value = '';
        addChatMessage('agent', '⏳ Pensando...');
        isProcessing = true;

        try {
            // El proyecto ya está en projectContextMessages; solo añadir Q&A reciente
            const messages = [
                { role: 'system', content: RESPONSE_SYSTEM_PROMPT },
                ...projectContextMessages,
                ...conversationHistory.slice(-MAX_CONVERSATION_HISTORY),
                { role: 'user', content: message }
            ];

            const response = await callDeepSeekAPI(messages);

            conversationHistory.push(
                { role: 'user', content: message },
                { role: 'assistant', content: response }
            );

            // Eliminar el mensaje "Pensando..."
            if (elements.chatMessages.lastChild) {
                elements.chatMessages.removeChild(elements.chatMessages.lastChild);
            }

            // Intentar parsear como XML estandarizado
            const parsed = parseStandardResponse(response);
            if (parsed) {
                if (parsed.analisis) {
                    addChatMessage('agent', parsed.analisis);
                }
                if (parsed.cambios && parsed.cambios.length > 0) {
                    const applied = applyParsedChanges(parsed.cambios);
                    if (applied > 0) {
                        addChatMessage('system', `✅ ${applied} archivo(s) actualizado(s) en el editor`);
                    }
                }
                if (parsed.instrucciones) {
                    addChatMessage('system', `💡 ${parsed.instrucciones}`);
                }
                // Si no se extrajo nada útil, mostrar la respuesta raw como fallback
                if (!parsed.analisis && !parsed.cambios?.length && !parsed.instrucciones) {
                    addChatMessage('agent', response);
                }
            } else {
                // Fallback: parsear bloques de código markdown
                const parts = response.split('```');
                for (let i = 0; i < parts.length; i++) {
                    if (i % 2 === 0) {
                        if (parts[i].trim()) addChatMessage('agent', parts[i].trim());
                    } else {
                        const codeLines = parts[i].split('\n');
                        const language = codeLines[0].trim();
                        const code = codeLines.slice(1).join('\n').trim();
                        if (code) addChatMessage('agent', `\`\`\`${language}\n${code}\n\`\`\``, true);
                    }
                }
            }

        } catch (error) {
            console.error('Error:', error);
            if (elements.chatMessages.lastChild) {
                elements.chatMessages.removeChild(elements.chatMessages.lastChild);
            }
            addChatMessage('system', `❌ Error: ${error.message}`);
            if (error.message.includes('API Error: 400')) {
                addChatMessage('system', `💡 El proyecto puede ser demasiado grande para el contexto de DeepSeek (~128k tokens). Considera excluir archivos binarios o generados en el explorador ZIP.`);
            }
        } finally {
            isProcessing = false;
        }
    }

    // ===== APLICAR CAMBIOS DESDE EL CHAT =====
    function applyChangesFromChat(code) {
        if (!currentFile) return;

        const fileData = fileMap.get(currentFile);
        if (!fileData) return;

        // Extraer código de los bloques
        const codeMatch = code.match(/```(?:\w+)?\n([\s\S]*?)```/);
        if (codeMatch) {
            const newCode = codeMatch[1].trim();
            fileData.modified = newCode;
            modifiedFiles.set(currentFile, newCode);

            // Actualizar Diff Editor
            if (diffEditor) {
                const modifiedModel = monaco.editor.createModel(newCode, fileData.language);
                diffEditor.getModifiedEditor().setModel(modifiedModel);
            }

            updateMetrics();
            addChatMessage('system', '✅ Cambios aplicados al archivo actual');
        }
    }

    // ===== ACEPTAR CAMBIOS =====
    function acceptChanges() {
        if (currentFile) {
            addChatMessage('system', `✅ Cambios aceptados para ${currentFile}`);
        }
    }

    // ===== RECHAZAR CAMBIOS =====
    function rejectChanges() {
        if (currentFile) {
            const fileData = fileMap.get(currentFile);
            if (fileData) {
                // Revertir a original
                fileData.modified = fileData.original;
                modifiedFiles.delete(currentFile);

                // Actualizar Diff Editor
                if (diffEditor) {
                    const originalModel = monaco.editor.createModel(fileData.original, fileData.language);
                    diffEditor.setModel({
                        original: originalModel,
                        modified: monaco.editor.createModel(fileData.original, fileData.language)
                    });
                }

                updateMetrics();
                addChatMessage('system', `❌ Cambios rechazados para ${currentFile}`);
            }
        }
    }

    // ===== GUARDAR CAMBIOS =====
    async function saveChanges() {
        const changes = [];
        for (const [filename, content] of modifiedFiles) {
            changes.push({ filename, content });
        }

        await DeepAgentDB.saveChanges(sessionId, changes);
        addChatMessage('system', `✅ Cambios guardados (${changes.length} archivos modificados)`);
    }

    // ===== EXPORTAR SESIÓN =====
    function exportSession() {
        const sessionData = {
            sessionId,
            timestamp: new Date().toISOString(),
            files: Array.from(fileMap.entries()).map(([name, data]) => ({
                name,
                original: data.original,
                modified: modifiedFiles.get(name) || data.original,
                language: data.language
            })),
            conversation: conversationHistory
        };

        const blob = new Blob([escapeObjectForJSON(sessionData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(url);

        addChatMessage('system', '✅ Sesión exportada');
    }

    // ===== TOGGLE PANEL =====
    function togglePanel(panelId, show) {
        const panel = document.getElementById(`${panelId}Panel`);
        if (panel) {
            if (show) {
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
            activePanels[panelId] = show;
        }
    }

    // ===== RESET LAYOUT =====
    function resetLayout() {
        togglePanel('tree', true);
        togglePanel('diff', true);
        togglePanel('agent', true);

        elements.toggleTree.checked = true;
        elements.toggleDiff.checked = true;
        elements.toggleAgent.checked = true;

        document.querySelectorAll('.panel').forEach(panel => {
            panel.style.width = '';
        });
    }

    // ===== INICIALIZAR REDIMENSIONAMIENTO =====
    function initResize() {
        const handles = document.querySelectorAll('.panel-resize-handle');

        handles.forEach(handle => {
            const panel = handle.closest('.panel');
            const panelId = panel.dataset.panel;

            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                activeResizePanel = panelId;
                startX = e.clientX;
                startWidth = panel.offsetWidth;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !activeResizePanel) return;

            const panel = document.getElementById(`${activeResizePanel}Panel`);
            if (!panel) return;

            const width = startWidth + (e.clientX - startX);
            if (width > 200 && width < 800) {
                panel.style.width = width + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            activeResizePanel = null;
            document.body.style.cursor = 'default';
        });
    }

    // ===== INICIALIZAR PANEL CLOSES =====
    function initPanelCloses() {
        document.querySelectorAll('.panel-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const panelId = btn.dataset.panel;
                const checkbox = document.getElementById(`toggle${panelId.charAt(0).toUpperCase() + panelId.slice(1)}`);
                if (checkbox) {
                    checkbox.checked = false;
                }
                togglePanel(panelId, false);
            });
        });
    }

    // ===== INICIALIZAR EVENT LISTENERS =====
    function initEventListeners() {
        elements.toggleTree.addEventListener('change', (e) => togglePanel('tree', e.target.checked));
        elements.toggleDiff.addEventListener('change', (e) => togglePanel('diff', e.target.checked));
        elements.toggleAgent.addEventListener('change', (e) => togglePanel('agent', e.target.checked));

        elements.sendBtn.addEventListener('click', sendMessage);
        elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        elements.saveChangesBtn.addEventListener('click', saveChanges);
        elements.exportSessionBtn.addEventListener('click', exportSession);
        if (elements.reloadContextBtn) {
            elements.reloadContextBtn.addEventListener('click', () => {
                conversationHistory = [];
                initProjectContext();
            });
        }
        elements.refreshMetrics.addEventListener('click', updateMetrics);
        elements.resetLayout.addEventListener('click', resetLayout);
        elements.acceptChangesBtn.addEventListener('click', acceptChanges);
        elements.rejectChangesBtn.addEventListener('click', rejectChanges);

        elements.treeSearch.addEventListener('keyup', filterTree);
    }

    // ===== INICIALIZACIÓN =====
    window.addEventListener('load', async () => {
        initTabs();
        initDiffEditor();
        initResize();
        initPanelCloses();
        initEventListeners();

        if (await loadSessionData()) {
            // Seleccionar primer archivo automáticamente
            const firstFile = Array.from(fileMap.keys())[0];
            if (firstFile) {
                setTimeout(() => selectFile(firstFile), 500);
            }
            // Iniciar carga del contexto en partes Base64
            await initProjectContext();
        }
    });
})();