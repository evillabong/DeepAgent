(function() {
    // Estado global
    let filesData = [];
    let filesBinary = [];
    let currentSelectedPath = '';
    let fileMap = new Map();
    let searchResults = [];
    let monacoEditor = null;
    let currentLanguage = 'plaintext';
    let currentFontSize = 'normal';
    let isMonacoReady = false;
    let currentSessionId = null;
    
    // Nuevas variables para exclusión
    let excludedExtensions = new Set();
    let availableExtensions = new Set();
    let isExclusionPanelCollapsed = false;
    
    // Configuración de lenguajes para Monaco
    const languageMap = {
        'cs': 'csharp',
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'py': 'python',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'h': 'cpp',
        'php': 'php',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust',
        'html': 'html',
        'htm': 'html',
        'css': 'css',
        'scss': 'scss',
        'json': 'json',
        'xml': 'xml',
        'md': 'markdown',
        'sql': 'sql',
        'sh': 'shell',
        'bat': 'batch',
        'ps1': 'powershell'
    };

    // Elementos DOM
    const elements = {
        zipInput: document.getElementById('zipFileInput'),
        processBtn: document.getElementById('processZipBtn'),
        agentSessionBtn: document.getElementById('agentSessionBtn'),
        treeContainer: document.getElementById('treeContainer'),
        treePanel: document.getElementById('treePanel'),
        resizeHandle: document.getElementById('resizeHandle'),
        filenameDisplay: document.getElementById('filenameDisplay'),
        statusBar: document.getElementById('statusBar'),
        searchInput: document.getElementById('searchInput'),
        searchScope: document.getElementById('searchScope'),
        useRegex: document.getElementById('useRegex'),
        searchBtn: document.getElementById('searchBtn'),
        searchResults: document.getElementById('searchResults'),
        viewTabs: document.querySelectorAll('.view-tab'),
        splitView: document.getElementById('splitView'),
        fullView: document.getElementById('fullView'),
        fullviewContent: document.getElementById('fullviewContent'),
        fullviewTreeContainer: document.getElementById('fullviewTreeContainer'),
        fullviewTreeSearch: document.getElementById('fullviewTreeSearch'),
        fullviewSearchInput: document.getElementById('fullviewSearchInput'),
        fullviewSearchBtn: document.getElementById('fullviewSearchBtn'),
        expandAllBtn: document.getElementById('expandAllBtn'),
        collapseAllBtn: document.getElementById('collapseAllBtn'),
        languageSelector: document.getElementById('languageSelector'),
        downloadCurrentBtn: document.getElementById('downloadCurrentBtn'),
        copyCurrentBtn: document.getElementById('copyCurrentBtn'),
        fontSizeSelector: document.getElementById('fontSizeSelector'),
        visibleFilesCount: document.getElementById('visibleFilesCount'),
        progressIndicator: document.getElementById('progressIndicator'),
        progressMessage: document.getElementById('progressMessage'),
        progressBarFill: document.getElementById('progressBarFill'),
        progressPercentage: document.getElementById('progressPercentage')
    };

    // Verificar que el botón existe
    if (!elements.agentSessionBtn) {
        console.warn('Botón de agente no encontrado en el DOM');
    }

    // Utilidades
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

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

    // Generar GUID único
    function generateGUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Analizar extensiones disponibles en los archivos
    function analyzeExtensions() {
        availableExtensions.clear();
        filesData.forEach(file => {
            const ext = getFileExtension(file.nombre);
            if (ext) availableExtensions.add(ext);
        });
        
        // Ordenar extensiones alfabéticamente
        const sortedExts = Array.from(availableExtensions).sort();
        renderExtensionList(sortedExts);
        updateExclusionStats();
        updateExclusionBadge();
    }

    // Obtener extensión de archivo
    function getFileExtension(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : 'sin extensión';
    }

    // Renderizar lista de extensiones con checkboxes
    function renderExtensionList(extensions) {
        const extensionList = document.getElementById('extensionList');
        if (!extensionList) return;
        
        let html = '';
        extensions.forEach(ext => {
            const isExcluded = excludedExtensions.has(ext);
            html += `
                <div class="extension-item">
                    <input type="checkbox" 
                           id="ext-${ext}" 
                           value="${ext}" 
                           ${isExcluded ? 'checked' : ''}>
                    <label for="ext-${ext}">.${ext}</label>
                </div>
            `;
        });
        
        extensionList.innerHTML = html;
        
        // Agregar event listeners a los checkboxes
        extensionList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const ext = e.target.value;
                if (e.target.checked) {
                    excludedExtensions.add(ext);
                } else {
                    excludedExtensions.delete(ext);
                }
                updateExclusionStats();
                updateExclusionBadge();
                refreshTreeWithExclusions();
                refreshFullViewWithExclusions();
            });
        });
    }

    // Actualizar estadísticas de exclusión
    function updateExclusionStats() {
        const totalFiles = filesData.length;
        const excludedCount = filesData.filter(file => 
            excludedExtensions.has(getFileExtension(file.nombre))
        ).length;
        const visibleCount = totalFiles - excludedCount;
        
        const totalEl = document.getElementById('totalFilesCount');
        const excludedEl = document.getElementById('excludedFilesCount');
        const visibleEl = document.getElementById('visibleFilesCount');
        
        if (totalEl) totalEl.textContent = totalFiles;
        if (excludedEl) excludedEl.textContent = excludedCount;
        if (visibleEl) visibleEl.textContent = visibleCount;
    }

    // Actualizar badge de exclusión
    function updateExclusionBadge() {
        const badge = document.getElementById('exclusionBadge');
        if (badge) {
            const excludedCount = filesData.filter(file => 
                excludedExtensions.has(getFileExtension(file.nombre))
            ).length;
            badge.textContent = `${excludedCount} excluidos`;
            badge.style.display = excludedCount > 0 ? 'inline' : 'none';
        }
    }

    // Refrescar árbol con exclusiones aplicadas
    function refreshTreeWithExclusions() {
        if (!filesData.length) return;
        
        const paths = filesData.map(f => f.nombre);
        const root = { name: 'root', type: 'folder', children: [], fullPath: '' };
        
        for (const path of paths) {
            const ext = getFileExtension(path);
            const isExcluded = excludedExtensions.has(ext);
            
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
                        children: isFile ? null : [],
                        excluded: isFile ? isExcluded : false
                    };
                    current.children.push(child);
                }
                
                if (!isFile) current = child;
            }
        }
        
        renderTreeWithExclusions(root, elements.treeContainer);
    }

    // Renderizar árbol con exclusiones
    function renderTreeWithExclusions(node, container) {
        container.innerHTML = '';
        
        function render(node, container) {
            if (!node.children) return;
            
            node.children.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            
            for (const child of node.children) {
                const itemDiv = document.createElement('div');
                itemDiv.className = `tree-item ${child.excluded ? 'excluded' : ''}`;
                if (child.fullPath === currentSelectedPath && !child.excluded) itemDiv.classList.add('selected');
                
                const icon = child.type === 'folder' ? '📁' : (child.excluded ? '🚫' : '📄');
                itemDiv.innerHTML = `
                    <span class="folder-icon">${icon}</span>
                    <span class="file-name" title="${child.fullPath}">${child.name}</span>
                `;
                
                itemDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (child.type === 'file' && !child.excluded) {
                        document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
                        itemDiv.classList.add('selected');
                        currentSelectedPath = child.fullPath;
                        displayFileInMonaco(child.fullPath);
                    } else if (child.type === 'folder') {
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

    // Refrescar vista completa con exclusiones
    function refreshFullViewWithExclusions() {
        if (!filesData.length) return;
        
        let html = '';
        const filteredFiles = filesData.filter(file => 
            !excludedExtensions.has(getFileExtension(file.nombre))
        );
        
        for (const file of filteredFiles) {
            const fileId = `file-${file.nombre.replace(/[\/\.]/g, '-')}`;
            const escapedContent = file.contenido
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            html += `<div class="file-section" data-filename="${file.nombre}" id="${fileId}">`;
            html += `<div class="file-header expanded" data-file="${file.nombre}">`;
            html += `<span>📄 ${file.nombre} <span style="color:#666; font-size:0.9rem;">(${file.lineCount} líneas, ${formatBytes(file.tamaño)})</span></span>`;
            html += `<span>▼</span>`;
            html += `</div>`;
            html += `<div class="file-content expanded">`;
            html += `<pre>${escapedContent}</pre>`;
            html += `</div>`;
            html += `</div>`;
        }
        
        elements.fullviewContent.innerHTML = html;
        
        // Actualizar contador
        elements.visibleFilesCount.textContent = `${filteredFiles.length} archivos totales (${filesData.length - filteredFiles.length} excluidos)`;
        
        // Agregar eventos a los encabezados
        document.querySelectorAll('.file-header').forEach(header => {
            header.addEventListener('click', () => {
                const content = header.nextElementSibling;
                const isExpanding = !content.classList.contains('expanded');
                
                content.classList.toggle('expanded');
                header.classList.toggle('expanded');
                header.querySelector('span:last-child').textContent = isExpanding ? '▼' : '▶';
            });
        });
    }

    // Guardar proyecto en Blob Storage (simulado con localStorage)
    async function saveProjectToBlob(sessionId, projectData) {
        try {
            // Crear el contenido del archivo de texto completo (respetando exclusiones)
            const fullText = generateFullProjectTextWithExclusions(projectData);
            
            // Calcular archivos excluidos
            const excludedFiles = projectData.filter(file => 
                excludedExtensions.has(getFileExtension(file.nombre))
            ).length;
            
            // Crear metadatos del proyecto
            const projectMetadata = {
                sessionId: sessionId,
                timestamp: new Date().toISOString(),
                fileName: `project-${sessionId}.txt`,
                fileSize: fullText.length,
                totalFiles: projectData.length,
                excludedFiles: excludedFiles,
                exportedFiles: projectData.length - excludedFiles,
                totalSize: projectData.reduce((acc, f) => acc + f.tamaño, 0),
                excludedExtensions: Array.from(excludedExtensions),
                files: projectData.map(f => ({
                    nombre: f.nombre,
                    tamaño: f.tamaño,
                    lineas: f.lineCount,
                    lenguaje: f.lenguaje,
                    excluido: excludedExtensions.has(getFileExtension(f.nombre))
                }))
            };
            
            // Guardar en localStorage (simulación de blob storage)
            localStorage.setItem(`session_${sessionId}`, JSON.stringify({
                content: fullText,
                metadata: projectMetadata
            }));
            
            // También guardar una referencia a la sesión actual
            localStorage.setItem('currentSession', sessionId);
            
            return {
                sessionId,
                metadata: projectMetadata
            };
        } catch (error) {
            console.error('Error guardando proyecto:', error);
            throw error;
        }
    }

    // Generar texto completo del proyecto (respetando exclusiones)
    function generateFullProjectTextWithExclusions(projectData) {
        let content = '';
        const filteredData = projectData.filter(file => 
            !excludedExtensions.has(getFileExtension(file.nombre))
        );
        
        content += `📦 PROYECTO: Proyecto analizado\n`;
        content += `📊 FECHA: ${new Date().toLocaleString()}\n`;
        content += `📝 TOTAL ARCHIVOS: ${projectData.length}\n`;
        content += `🚫 ARCHIVOS EXCLUIDOS: ${projectData.length - filteredData.length}\n`;
        content += `📄 ARCHIVOS EXPORTADOS: ${filteredData.length}\n`;
        content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        for (const file of filteredData) {
            content += `📄 ARCHIVO: ${file.nombre}\n`;
            content += `📏 LÍNEAS: ${file.lineCount} | TAMAÑO: ${formatBytes(file.tamaño)}\n`;
            content += `────────────────────────────────\n`;
            content += file.contenido;
            content += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        }
        
        return content;
    }

    // Generar texto completo del proyecto (wrapper para compatibilidad)
    function generateFullProjectText(projectData) {
        return generateFullProjectTextWithExclusions(projectData);
    }

    // Iniciar sesión de agente
    async function startAgentSession() {
        if (!filesData.length) {
            alert('Primero procesa un archivo ZIP');
            return;
        }
        
        showProgress('Preparando sesión del agente...', true);
        
        try {
            // Generar GUID único
            const sessionId = generateGUID();
            
            updateProgress(30, 'Generando archivo de proyecto...');
            
            // Guardar proyecto en blob storage (simulado)
            const sessionData = await saveProjectToBlob(sessionId, filesData);
            
            updateProgress(80, 'Preparando entorno...');
            
            // Guardar el ID de sesión actual
            currentSessionId = sessionId;
            
            updateProgress(100, '¡Sesión lista!');
            
            // Mostrar mensaje de éxito
            elements.statusBar.innerHTML = `✅ Sesión creada: ${sessionId}`;
            
            // Redirigir a la página del agente (abre nueva ventana)
            setTimeout(() => {
                redirectToAgent();
            }, 500);
            
            setTimeout(hideProgress, 1000);
            
        } catch (error) {
            hideProgress();
            elements.statusBar.innerHTML = `❌ Error: ${error.message}`;
            console.error(error);
        }
    }

    // Redirigir a la página del agente
    function redirectToAgent() {
        if (!currentSessionId) {
            alert('Primero inicia una sesión de agente');
            return;
        }
        
        // Guardar el estado actual antes de redirigir
        const sessionState = {
            sessionId: currentSessionId,
            currentFile: currentSelectedPath,
            files: filesData.map(f => f.nombre),
            excludedExtensions: Array.from(excludedExtensions),
            timestamp: new Date().toISOString()
        };
        
        localStorage.setItem(`session_state_${currentSessionId}`, JSON.stringify(sessionState));
        
        // Construir URL del agente (para desarrollo)
        const agentUrl = `/agent/${currentSessionId}`;
        
        // Abrir en nueva ventana
        window.open(agentUrl, '_blank');
        
        elements.statusBar.innerHTML = `🚀 Sesión ${currentSessionId} iniciada en nueva ventana`;
    }

    // Cambiar tamaño de fuente global
    function setFontSize(size) {
        document.body.classList.remove('font-size-small', 'font-size-normal', 'font-size-large', 'font-size-xlarge');
        document.body.classList.add(`font-size-${size}`);
        currentFontSize = size;
        
        // Actualizar Monaco si existe
        if (monacoEditor) {
            const fontSizeMap = {
                'small': 11,
                'normal': 13,
                'large': 15,
                'xlarge': 17
            };
            monacoEditor.updateOptions({ fontSize: fontSizeMap[size] });
        }
    }

    // Inicializar Monaco Editor
    function initMonaco() {
        // Configurar require.js para Monaco
        require.config({ 
            paths: { 
                vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.34.1/min/vs' 
            }
        });
        
        // Cargar Monaco
        require(['vs/editor/editor.main'], function() {
            // Crear el editor
            monacoEditor = monaco.editor.create(document.getElementById('monacoContainer'), {
                value: '// Selecciona un archivo del árbol para ver su contenido',
                language: 'plaintext',
                theme: 'vs',
                automaticLayout: true,
                readOnly: true,
                minimap: {
                    enabled: true,
                    maxColumn: 80
                },
                scrollBeyondLastLine: false,
                fontSize: 13,
                fontFamily: 'Fira Code, Consolas, "Courier New", monospace',
                fontLigatures: true,
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                tabSize: 4,
                wordWrap: 'on',
                wrappingIndent: 'same',
                lineHeight: 1.5,
                renderLineHighlight: 'all',
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                scrollbar: {
                    vertical: 'visible',
                    horizontal: 'visible',
                    useShadows: true,
                    verticalHasArrows: false,
                    horizontalHasArrows: false
                }
            });
            
            isMonacoReady = true;
            console.log('Monaco Editor inicializado correctamente');
        });
    }

    // Obtener lenguaje de Monaco basado en nombre de archivo
    function getLanguageFromFilename(filename) {
        const parts = filename.split('/');
        const basename = parts[parts.length - 1];
        const extension = basename.split('.').pop().toLowerCase();
        return languageMap[extension] || 'plaintext';
    }

    // Procesar ZIP
    async function processZip(file) {
        showProgress('Analizando ZIP...', true);
        
        try {
            const zip = new JSZip();
            updateProgress(10, 'Cargando contenido...');
            
            const contenido = await zip.loadAsync(file);
            const textFiles = [];
            const binFiles = [];
            fileMap.clear();

            const entries = Object.entries(contenido.files);
            let processed = 0;

            for (const [nombre, archivo] of entries) {
                if (archivo.dir) {
                    processed++;
                    continue;
                }

                try {
                    const contenidoStr = await archivo.async('string');
                    
                    if (!contenidoStr.includes('\u0000') && contenidoStr.length > 0) {
                        const lineas = contenidoStr.split('\n');
                        textFiles.push({
                            nombre,
                            contenido: contenidoStr,
                            tamaño: contenidoStr.length,
                            lineas,
                            lineCount: lineas.length,
                            lenguaje: getLanguageFromFilename(nombre)
                        });
                        fileMap.set(nombre, contenidoStr);
                    } else {
                        binFiles.push({ nombre, tamaño: archivo._data?.uncompressedSize || 0 });
                    }
                } catch {
                    binFiles.push({ nombre, tamaño: archivo._data?.uncompressedSize || 0 });
                }

                processed++;
                updateProgress(20 + Math.floor((processed / entries.length) * 60), 
                    `Procesados ${processed}/${entries.length} archivos...`);
            }

            filesData = textFiles.sort((a, b) => a.nombre.localeCompare(b.nombre));
            filesBinary = binFiles;

            // Analizar extensiones disponibles
            analyzeExtensions();

            updateProgress(90, 'Construyendo árbol...');
            refreshTreeWithExclusions();
            
            // Construir árbol para vista completa
            buildFullViewTree(filesData);
            
            // Generar vista completa
            refreshFullViewWithExclusions();
            
            updateProgress(100, '¡Completado!');
            elements.statusBar.innerHTML = `✅ ${filesData.length} archivos texto, ${filesBinary.length} binarios`;
            
            // Habilitar el botón de agente
            if (elements.agentSessionBtn) {
                elements.agentSessionBtn.disabled = false;
                elements.agentSessionBtn.classList.add('active');
            }
            
            setTimeout(hideProgress, 500);
            
        } catch (error) {
            hideProgress();
            elements.statusBar.innerHTML = `❌ Error: ${error.message}`;
            console.error(error);
        }
    }

    // Construir árbol jerárquico para vista completa
    function buildFullViewTree(files) {
        const root = { name: 'root', type: 'folder', children: [], fullPath: '' };
        const paths = files.map(f => f.nombre);
        
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
        
        renderFullViewTree(root, elements.fullviewTreeContainer);
    }

    // Renderizar árbol en vista completa
    function renderFullViewTree(node, container) {
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
                
                const icon = child.type === 'folder' ? '📁' : '📄';
                itemDiv.innerHTML = `
                    <span class="folder-icon">${icon}</span>
                    <span class="file-name" title="${child.fullPath}">${child.name}</span>
                `;
                
                itemDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (child.type === 'file') {
                        scrollToFileInFullView(child.fullPath);
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

    // Filtrar árbol en vista completa
    function filterFullViewTree() {
        const filterText = elements.fullviewTreeSearch.value.toLowerCase();
        const items = document.querySelectorAll('#fullviewTreeContainer .tree-item');
        
        items.forEach(item => {
            const fileName = item.querySelector('.file-name').textContent.toLowerCase();
            const shouldShow = !filterText || fileName.includes(filterText);
            item.style.display = shouldShow ? 'flex' : 'none';
        });
    }

    // Scroll a archivo en vista completa
    function scrollToFileInFullView(filename) {
        const elements = document.querySelectorAll('.file-section');
        for (const el of elements) {
            if (el.dataset.filename === filename) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                
                // Expandir si está colapsado
                const header = el.querySelector('.file-header');
                const content = el.querySelector('.file-content');
                if (!content.classList.contains('expanded')) {
                    header.click();
                }
                break;
            }
        }
    }

    // Expandir todos
    function expandAllFiles() {
        document.querySelectorAll('.file-header').forEach(header => {
            const content = header.nextElementSibling;
            if (!content.classList.contains('expanded')) {
                content.classList.add('expanded');
                header.classList.add('expanded');
                header.querySelector('span:last-child').textContent = '▼';
            }
        });
    }

    // Colapsar todos
    function collapseAllFiles() {
        document.querySelectorAll('.file-header').forEach(header => {
            const content = header.nextElementSibling;
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                header.classList.remove('expanded');
                header.querySelector('span:last-child').textContent = '▶';
            }
        });
    }

    // Buscar en vista completa
    function searchInFullView() {
        const term = elements.fullviewSearchInput.value.toLowerCase();
        if (!term) return;
        
        const sections = document.querySelectorAll('.file-section');
        let matchCount = 0;
        
        sections.forEach(section => {
            const content = section.querySelector('.file-content pre').textContent.toLowerCase();
            const filename = section.dataset.filename.toLowerCase();
            const matches = content.includes(term) || filename.includes(term);
            
            if (matches) {
                matchCount++;
                section.style.display = 'block';
                
                // Expandir para mostrar
                const header = section.querySelector('.file-header');
                const contentDiv = section.querySelector('.file-content');
                if (!contentDiv.classList.contains('expanded')) {
                    header.click();
                }
            } else {
                section.style.display = 'none';
            }
        });
        
        elements.visibleFilesCount.textContent = `${matchCount} archivos coinciden`;
    }

    // Limpiar búsqueda en vista completa
    function clearFullViewSearch() {
        elements.fullviewSearchInput.value = '';
        document.querySelectorAll('.file-section').forEach(section => {
            section.style.display = 'block';
        });
        refreshFullViewWithExclusions();
    }

    // Mostrar archivo en Monaco Editor
    function displayFileInMonaco(fullPath) {
        if (!isMonacoReady || !monacoEditor) {
            console.warn('Monaco no está listo aún');
            return;
        }
        
        const content = fileMap.get(fullPath);
        if (!content) return;
        
        elements.filenameDisplay.textContent = fullPath;
        
        const language = getLanguageFromFilename(fullPath);
        currentLanguage = language;
        
        monacoEditor.setValue(content);

        const model = monacoEditor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, language);
        }        
        
        // Actualizar selector de lenguaje
        if (elements.languageSelector) {
            elements.languageSelector.value = language;
        }
    }

    // Cambiar lenguaje manualmente
    function changeLanguage(language) {
        if (monacoEditor && currentSelectedPath) {
            if (monacoEditor) {
                const model = monacoEditor.getModel();
                if (model) {
                    monaco.editor.setModelLanguage(model, language);
                }
            }        
        }
    }

    // Buscar en archivos (vista dividida)
    function performSearch() {
        const searchTerm = elements.searchInput.value;
        if (!searchTerm) {
            elements.searchResults.innerHTML = '<div>Introduce un término de búsqueda</div>';
            return;
        }
        
        const scope = elements.searchScope.value;
        const useRegex = elements.useRegex.checked;
        
        let regex;
        try {
            regex = useRegex ? new RegExp(searchTerm, 'gi') : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        } catch (e) {
            elements.searchResults.innerHTML = '<div style="color:red;">❌ Expresión regular inválida</div>';
            return;
        }
        
        searchResults = [];
        let targetFiles = scope === 'current' && currentSelectedPath 
            ? filesData.filter(f => f.nombre === currentSelectedPath)
            : filesData;
        
        for (const file of targetFiles) {
            const matches = [];
            const lines = file.contenido.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                regex.lastIndex = 0;
                if (regex.test(lines[i])) {
                    matches.push({
                        line: i + 1,
                        text: lines[i].substring(0, 60) + (lines[i].length > 60 ? '...' : '')
                    });
                }
            }
            
            if (matches.length > 0) {
                searchResults.push({
                    file: file.nombre,
                    matches
                });
            }
        }
        
        displaySearchResults();
    }

    // Mostrar resultados de búsqueda con botón de cierre
    function displaySearchResults() {
        if (searchResults.length === 0) {
            elements.searchResults.innerHTML = '<div>No se encontraron resultados</div>';
            return;
        }
        
        let html = `<div class="search-results-header">`;
        html += `<span>🔎 ${searchResults.reduce((acc, r) => acc + r.matches.length, 0)} ocurrencias</span>`;
        html += `<button class="close-results-btn" id="closeSearchResults">✕</button>`;
        html += `</div>`;
        
        for (const result of searchResults.slice(0, 10)) {
            html += `<div class="search-result-item" data-file="${result.file}">`;
            html += `<div class="result-filename">📄 ${result.file.split('/').pop()}</div>`;
            
            for (const match of result.matches.slice(0, 2)) {
                html += `<div class="result-line">Línea ${match.line}: ${match.text}</div>`;
            }
            
            if (result.matches.length > 2) {
                html += `<div class="result-line">... y ${result.matches.length - 2} más</div>`;
            }
            
            html += '</div>';
        }
        
        if (searchResults.length > 10) {
            html += `<div>... y ${searchResults.length - 10} archivos más</div>`;
        }
        
        elements.searchResults.innerHTML = html;
        
        // Botón de cierre
        document.getElementById('closeSearchResults')?.addEventListener('click', () => {
            elements.searchResults.innerHTML = '';
        });
        
        // Eventos para hacer clic en resultados
        document.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const filename = item.dataset.file;
                
                setActiveView('split');
                
                currentSelectedPath = filename;
                displayFileInMonaco(filename);
                
                document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
                const treeItems = document.querySelectorAll('.tree-item');
                for (const treeItem of treeItems) {
                    if (treeItem.querySelector('.file-name')?.textContent === filename.split('/').pop()) {
                        treeItem.classList.add('selected');
                        break;
                    }
                }
                
                // Cerrar resultados después de seleccionar
                elements.searchResults.innerHTML = '';
            });
        });
    }

    // Cambiar vista activa
    function setActiveView(view) {
        elements.viewTabs.forEach(tab => {
            const tabView = tab.dataset.view;
            if (tabView === view) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
        
        if (view === 'split') {
            elements.splitView.classList.add('active');
            elements.fullView.classList.remove('active');
        } else {
            elements.splitView.classList.remove('active');
            elements.fullView.classList.add('active');
            
            if (!elements.fullviewContent.children.length && filesData.length) {
                refreshFullViewWithExclusions();
            }
        }
    }

    // Redimensionar panel izquierdo
    function initResize() {
        let isResizing = false;
        let startX, startWidth;
        
        elements.resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(document.defaultView.getComputedStyle(elements.treePanel).width, 10);
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const width = startWidth + (e.clientX - startX);
            if (width > 200 && width < 600) {
                elements.treePanel.style.width = width + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });
    }

    // Descargar vista actual
    function downloadCurrentView() {
        let content = '';
        let filename = '';
        
        if (elements.splitView.classList.contains('active')) {
            if (currentSelectedPath) {
                // Verificar si el archivo actual está excluido
                const ext = getFileExtension(currentSelectedPath);
                if (excludedExtensions.has(ext)) {
                    if (!confirm('El archivo actual está excluido. ¿Descargar de todas formas?')) {
                        return;
                    }
                }
                content = fileMap.get(currentSelectedPath) || '';
                filename = currentSelectedPath.split('/').pop() || 'archivo.txt';
            } else {
                content = '// No hay archivo seleccionado';
                filename = 'sin-seleccion.txt';
            }
        } else {
            content = generateFullProjectTextWithExclusions(filesData);
            filename = 'vista-completa.txt';
        }
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        const excludedCount = filesData.length - filesData.filter(f => !excludedExtensions.has(getFileExtension(f.nombre))).length;
        elements.statusBar.innerHTML = `✅ Descargado: ${filename} (${excludedCount} archivos excluidos)`;
    }

    // Copiar al portapapeles
    function copyCurrentView() {
        let content = '';
        
        if (elements.splitView.classList.contains('active')) {
            content = currentSelectedPath ? (fileMap.get(currentSelectedPath) || '') : '// No hay archivo seleccionado';
        } else {
            content = generateFullProjectTextWithExclusions(filesData);
        }
        
        navigator.clipboard.writeText(content).then(() => {
            elements.statusBar.innerHTML = '✅ Copiado al portapapeles';
            setTimeout(() => {
                elements.statusBar.innerHTML = '📋 Listo';
            }, 2000);
        });
    }

    // Event Listeners
    elements.processBtn.addEventListener('click', async () => {
        if (!elements.zipInput.files[0]) {
            alert('Selecciona un archivo ZIP');
            return;
        }
        elements.processBtn.disabled = true;
        await processZip(elements.zipInput.files[0]);
        elements.processBtn.disabled = false;
    });

    // Event listener para el botón del agente
    if (elements.agentSessionBtn) {
        elements.agentSessionBtn.addEventListener('click', startAgentSession);
    }

    elements.searchBtn.addEventListener('click', performSearch);
    elements.searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    elements.viewTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            setActiveView(tab.dataset.view);
        });
    });

    elements.fullviewSearchBtn.addEventListener('click', () => {
        if (elements.fullviewSearchInput.value) {
            searchInFullView();
        } else {
            clearFullViewSearch();
        }
    });

    elements.fullviewSearchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            if (e.target.value) {
                searchInFullView();
            } else {
                clearFullViewSearch();
            }
        }
    });

    elements.fullviewTreeSearch.addEventListener('keyup', filterFullViewTree);
    
    elements.expandAllBtn.addEventListener('click', expandAllFiles);
    elements.collapseAllBtn.addEventListener('click', collapseAllFiles);
    
    elements.downloadCurrentBtn.addEventListener('click', downloadCurrentView);
    elements.copyCurrentBtn.addEventListener('click', copyCurrentView);
    
    if (elements.languageSelector) {
        elements.languageSelector.addEventListener('change', (e) => {
            changeLanguage(e.target.value);
        });
    }
    
    if (elements.fontSizeSelector) {
        elements.fontSizeSelector.addEventListener('change', (e) => {
            setFontSize(e.target.value);
        });
    }

    // Event listeners para exclusión
    const toggleExclusionBtn = document.getElementById('toggleExclusionPanel');
    const exclusionContent = document.getElementById('exclusionContent');
    const selectAllExtensions = document.getElementById('selectAllExtensions');
    const deselectAllExtensions = document.getElementById('deselectAllExtensions');
    
    if (toggleExclusionBtn) {
        toggleExclusionBtn.addEventListener('click', () => {
            isExclusionPanelCollapsed = !isExclusionPanelCollapsed;
            exclusionContent.classList.toggle('collapsed', isExclusionPanelCollapsed);
            toggleExclusionBtn.textContent = isExclusionPanelCollapsed ? '▶' : '▼';
        });
    }
    
    if (selectAllExtensions) {
        selectAllExtensions.addEventListener('click', () => {
            document.querySelectorAll('#extensionList input[type="checkbox"]').forEach(cb => {
                cb.checked = true;
                excludedExtensions.add(cb.value);
            });
            updateExclusionStats();
            updateExclusionBadge();
            refreshTreeWithExclusions();
            refreshFullViewWithExclusions();
        });
    }
    
    if (deselectAllExtensions) {
        deselectAllExtensions.addEventListener('click', () => {
            document.querySelectorAll('#extensionList input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
                excludedExtensions.delete(cb.value);
            });
            updateExclusionStats();
            updateExclusionBadge();
            refreshTreeWithExclusions();
            refreshFullViewWithExclusions();
        });
    }

    // Inicialización
    window.addEventListener('load', () => {
        initMonaco();
        initResize();
        setFontSize('normal');
        
        // Deshabilitar botón de agente inicialmente
        if (elements.agentSessionBtn) {
            elements.agentSessionBtn.disabled = true;
        }
    });
})();