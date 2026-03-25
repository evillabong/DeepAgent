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
    let conversationHistory = []; // Historial de la conversación con DeepSeek
    let isProcessing = false;
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

    // ===== OBTENER SESSION ID DE LA URL =====
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
    function loadSessionData() {
        sessionId = getSessionIdFromUrl();

        if (!sessionId) {
            sessionId = localStorage.getItem('currentSession');
        }

        if (!sessionId) {
            elements.sessionId.textContent = 'No hay sesión activa';
            addChatMessage('system', '❌ No hay sesión activa. Vuelve a la página principal y procesa un ZIP.');
            return false;
        }

        elements.sessionId.textContent = sessionId;

        // Cargar datos de la sesión
        const sessionData = localStorage.getItem(`session_${sessionId}`);
        if (!sessionData) {
            addChatMessage('system', '❌ No se encontraron datos para esta sesión');
            return false;
        }

        try {
            const parsed = JSON.parse(sessionData);

            // Guardar el texto completo del proyecto
            fullProjectText = parsed.content;

            // Parsear los archivos individuales
            parseProjectFiles(parsed.content);

            // Cargar cambios guardados previamente si existen
            const savedChanges = localStorage.getItem(`changes_${sessionId}`);
            if (savedChanges) {
                const changes = JSON.parse(savedChanges);
                changes.forEach(change => {
                    if (fileMap.has(change.filename)) {
                        fileMap.get(change.filename).modified = change.content;
                        modifiedFiles.set(change.filename, change.content);
                    }
                });
            }

            addChatMessage('agent', `✅ Sesión cargada: ${fileMap.size} archivos encontrados (${formatBytes(fullProjectText.length)})`);
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

    // ===== ENVIAR MENSAJE AL AGENTE CON PROYECTO COMPLETO =====
    async function sendMessage() {
        if (isProcessing) return;

        const message = elements.chatInput.value.trim();
        if (!message) return;

        // Agregar mensaje del usuario
        addChatMessage('user', message);
        elements.chatInput.value = '';

        // Mostrar indicador de pensamiento
        addChatMessage('agent', '⏳ Pensando...');

        isProcessing = true;

        try {
            // CONSTRUIR CONTEXTO CON EL PROYECTO COMPLETO (SIN LIMITAR)
            // Usando el formato oficial de DeepSeek para archivos [citation:10]
            let fileContexts = Array.from(fileMap.entries())
                .map(([filename, data]) => formatFileForDeepSeek(filename, data.original))
                .join('\n\n');
            const systemPrompt = `Eres un asistente experto en análisis de código especializado en revisar proyectos completos.

A continuación tienes el proyecto completo con todos sus archivos codificado con Base64:

${toBase64(fileContexts)}

El usuario puede preguntar sobre cualquier aspecto del proyecto, sugerir mejoras, o pedir modificaciones.
Cuando sugieras cambios en el código, preséntalos en bloques de código con el lenguaje apropiado usando el formato \`\`\`lenguaje\ncódigo\n\`\`\`.
Sé específico y profesional en tus respuestas. Puedes referirte a archivos específicos por su nombre.`;

            // Preparar mensajes para DeepSeek
            const messages = [
                { role: 'system', content: escapeObjectForJSON(systemPrompt) },
                ...conversationHistory.slice(-10), // Últimos 10 mensajes para contexto
                { role: 'user', content: message }
            ];

            // Llamar a DeepSeek
            const response = await callDeepSeekAPI(messages);

            // Actualizar historial
            conversationHistory.push(
                { role: 'user', content: message },
                { role: 'assistant', content: response }
            );

            // Eliminar mensaje de "pensando"
            if (elements.chatMessages.lastChild) {
                elements.chatMessages.removeChild(elements.chatMessages.lastChild);
            }

            // Procesar respuesta (detectar bloques de código)
            const parts = response.split('```');
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    // Texto normal
                    if (parts[i].trim()) {
                        addChatMessage('agent', parts[i].trim());
                    }
                } else {
                    // Código
                    const codeLines = parts[i].split('\n');
                    const language = codeLines[0].trim();
                    const code = codeLines.slice(1).join('\n').trim();

                    if (code) {
                        addChatMessage('agent', `\`\`\`${language}\n${code}\n\`\`\``, true);

                        // Si el código parece ser para el archivo actual, preguntar si quiere aplicarlo
                        if (currentFile && code.includes('function')) {
                            setTimeout(() => {
                                addChatMessage('system', '💡 ¿Quieres aplicar estos cambios al archivo actual? Usa los botones "Aceptar" o "Rechazar" abajo.');
                            }, 500);
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error:', error);

            // Eliminar mensaje de "pensando"
            if (elements.chatMessages.lastChild) {
                elements.chatMessages.removeChild(elements.chatMessages.lastChild);
            }

            // Mensaje de error más descriptivo
            addChatMessage('system', `❌ Error: ${error.message}`);

            // Sugerir solución
            if (error.message.includes('API Error: 400')) {
                addChatMessage('system', '💡 El proyecto puede ser demasiado grande. DeepSeek soporta hasta ~500k caracteres (128k tokens). Tu proyecto tiene aproximadamente ' + formatBytes(fullProjectText.length));
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
    function saveChanges() {
        const changes = [];
        for (const [filename, content] of modifiedFiles) {
            changes.push({ filename, content });
        }

        localStorage.setItem(`changes_${sessionId}`, JSON.stringify(changes));
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
        elements.refreshMetrics.addEventListener('click', updateMetrics);
        elements.resetLayout.addEventListener('click', resetLayout);
        elements.acceptChangesBtn.addEventListener('click', acceptChanges);
        elements.rejectChangesBtn.addEventListener('click', rejectChanges);

        elements.treeSearch.addEventListener('keyup', filterTree);
    }

    // ===== INICIALIZACIÓN =====
    window.addEventListener('load', () => {
        initTabs();
        initDiffEditor();
        initResize();
        initPanelCloses();
        initEventListeners();

        if (loadSessionData()) {
            // Seleccionar primer archivo automáticamente
            const firstFile = Array.from(fileMap.keys())[0];
            if (firstFile) {
                setTimeout(() => selectFile(firstFile), 500);
            }
        }
    });
    function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
    function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
}
})();