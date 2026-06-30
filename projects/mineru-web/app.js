/**
 * DocMiner Web Client — Main Application
 */

// ==================== Constants ====================
const STORAGE_KEYS = {
    TASKS: 'mineru.tasks',
    SETTINGS: 'mineru.settings'
};

const DEFAULT_SETTINGS = {
    modelVersion: 'vlm',
    forceOcr: false,
    enableFormula: true,
    enableTable: true,
    language: 'auto',
    outputDir: './output',
    userId: '-',
    modelSource: 'huggingface',
    modelCacheDir: ''
};

const STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    TIMEOUT: 'timeout'
};

const POLL_INTERVAL = 1500; // 1.5s
const POLL_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// ==================== State ====================
let currentPage = 'parse';
let currentTaskId = null;
let pollIntervalId = null;
let pollStartTime = null;
let progressIntervalId = null;
let simulationProgress = 0;

// PDF Viewer state
let pdfDoc = null;
let currentPageNum = 1;
let totalPages = 0;
let currentZoom = 1.0;
let currentRotation = 0;
let showBBox = false;
let middleJson = null;
let currentImageBlob = null;
let currentRenderTask = null;

// ==================== DOM Ready ====================
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initSidebar();
    initUpload();
    initExampleCards();
    initSettings();
    initKeyboardShortcuts();
    initViewerControls();
    initTasksPage();
    initViewerTabs();
    renderSidebarTasks();
});

// ==================== Router ====================
function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
}

function handleRoute() {
    const hash = window.location.hash || '#/parse';
    const parts = hash.split('/');
    
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    
    // Determine page
    if (parts[1] === 'viewer') {
        showViewer(parts[2]);
    } else if (parts[1] === 'tasks') {
        showTasks();
    } else if (parts[1] === 'favorites') {
        showFavorites();
    } else {
        showParse();
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-page') === parts[1]);
    });
}

function showParse() {
    currentPage = 'parse';
    document.getElementById('screenParse').style.display = 'block';
}

function showViewer(taskId) {
    currentPage = 'viewer';
    currentTaskId = taskId;
    document.getElementById('screenViewer').style.display = 'block';
    
    updateFavoriteBtn(taskId);

    // Reset loading states
    document.getElementById('paneLeftLoading').style.display = 'flex';
    document.getElementById('paneRightLoading').style.display = 'flex';
    const container = document.getElementById('canvasContainer');
    if (container) container.style.display = 'none';
    document.getElementById('markdownContent').style.display = 'none';
    
    const jsonContent = document.getElementById('jsonContent');
    if (jsonContent) jsonContent.style.display = 'none';

    // Reset active tab to markdown
    document.querySelectorAll('.pane-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === 'markdown');
    });

    // Hide actions container until content is loaded
    const actions = document.getElementById('paneRightActions');
    if (actions) actions.style.display = 'none';

    pdfDoc = null;
    currentImageBlob = null;
    middleJson = null;
    document.getElementById('bboxLayer').innerHTML = '';

    if (taskId === 'demo') {
        loadDemoContent();
    } else {
        const task = getTaskById(taskId);
        if (task) {
            document.getElementById('viewerTitle').textContent = task.fileName;
            if (task.status === STATUS.COMPLETED) {
                loadTaskContent(taskId);
            } else {
                showTaskLoadingStatus(task);
                startPolling(taskId);
            }
        } else {
            loadTaskContent(taskId);
        }
    }
}

function showTasks() {
    currentPage = 'tasks';
    document.getElementById('screenTasks').style.display = 'block';
    renderTasksTable();
}

function showFavorites() {
    currentPage = 'favorites';
    document.getElementById('screenFavorites').style.display = 'block';
    renderFavoritesTable();
}

// ==================== Sidebar ====================
function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const icon = toggle.querySelector('.toggle-icon');
        const isCollapsed = sidebar.classList.contains('collapsed');
        icon.textContent = isCollapsed ? '>>' : '<<';
        toggle.title = isCollapsed ? '展开侧栏' : '收起侧栏';
    });
    
    // New parse button
    document.getElementById('btnNewParse').addEventListener('click', () => {
        window.location.hash = '#/parse';
    });
}

function renderSidebarTasks() {
    const tasks = getTasks();
    const tasksList = document.getElementById('tasksList');
    const tasksCount = document.getElementById('tasksCount');
    
    tasksCount.textContent = tasks.length;
    
    // Sort by createdAt descending
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
    
    tasksList.innerHTML = sorted.slice(0, 10).map(task => {
        let subText = formatTime(task.createdAt);
        if (task.status === STATUS.COMPLETED) {
            subText = formatFileSize(task.fileSize);
        } else {
            subText = getStatusLabel(task.status);
            if (task.status === STATUS.PROCESSING) {
                subText = '解析中...';
            }
        }
        return `
            <div class="task-item ${task.taskId === currentTaskId && currentPage === 'viewer' ? 'active' : ''}" data-task-id="${task.taskId}" onclick="navigateToTask('${task.taskId}')" title="${escapeHtml(task.fileName)}">
                <div class="task-status ${task.status}"></div>
                <div class="task-info">
                    <div class="task-name">${escapeHtml(task.fileName)}</div>
                    <div class="task-time">${subText}</div>
                </div>
            </div>
        `;
    }).join('');
}

function navigateToTask(taskId) {
    window.location.hash = `#/viewer/${taskId}`;
}

// ==================== Upload ====================
function initUpload() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const btnSelectFile = document.getElementById('btnSelectFile');
    
    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
    
    // Click to select
    btnSelectFile.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });
}

function handleFile(file) {
    // Validate file type
    const allowedTypes = ['.pdf', '.png', '.jpg', '.jpeg'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedTypes.includes(ext)) {
        showToast('仅支持 PDF/PNG/JPG 格式', 'error');
        return;
    }
    
    // Start upload
    uploadFile(file);
}

async function uploadFile(file) {
    const progress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progress.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '上传中...';
    
    try {
        // Create FormData
        const formData = new FormData();
        formData.append('files', file);

        // Get settings
        const settings = getSettings();
        let backend = 'pipeline';
        if (settings.modelVersion === 'vlm') {
            backend = 'vlm-engine';
        } else if (settings.modelVersion === 'hybrid') {
            backend = 'hybrid-engine';
            formData.append('effort', 'high');
        }
        formData.append('backend', backend);
        formData.append('parse_method', 'auto');
        formData.append('formula_enable', settings.enableFormula);
        formData.append('table_enable', settings.enableTable);
        formData.append('lang_list', settings.language === 'auto' ? 'ch' : settings.language);
        formData.append('response_format_zip', 'true');
        formData.append('return_original_file', 'true');
        formData.append('return_images', 'true');
        formData.append('return_middle_json', 'true');
        
        // Simulate progress (real progress would need XMLHttpRequest)
        let progressValue = 0;
        const progressInterval = setInterval(() => {
            progressValue = Math.min(progressValue + 10, 90);
            progressFill.style.width = progressValue + '%';
        }, 200);
        
        // Upload
        const response = await fetch('/tasks', {
            method: 'POST',
            body: formData
        });
        
        clearInterval(progressInterval);
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const data = await response.json();

        progressFill.style.width = '100%';
        progressText.textContent = '上传完成';

        // Create task record (backend returns task_id with underscore)
        const task = {
            taskId: data.task_id,
            fileName: file.name,
            fileSize: file.size,
            createdAt: Date.now(),
            status: STATUS.PENDING,
            outputDir: null
        };

        saveTask(task);
        renderSidebarTasks();
        window.location.hash = `#/viewer/${task.taskId}`;
        startPolling(task.taskId);
        
        // Reset after delay
        setTimeout(() => {
            progress.style.display = 'none';
            progressFill.style.width = '0%';
        }, 2000);
        
    } catch (error) {
        console.error('Upload error:', error);
        showToast('上传失败: ' + error.message, 'error');
        progress.style.display = 'none';
    }
}

// ==================== Polling ====================
function startProgressSimulation(taskId) {
    if (progressIntervalId) {
        clearInterval(progressIntervalId);
    }
    
    simulationProgress = 5;
    updateProgressUI(simulationProgress);
    
    progressIntervalId = setInterval(() => {
        const task = getTaskById(taskId);
        if (!task) return;
        
        if (task.status === STATUS.PENDING) {
            if (simulationProgress < 15) {
                simulationProgress += 1.5;
            }
        } else if (task.status === STATUS.PROCESSING) {
            if (simulationProgress < 40) {
                simulationProgress += Math.floor(Math.random() * 5) + 3; // +3-7%
            } else if (simulationProgress < 75) {
                simulationProgress += Math.floor(Math.random() * 3) + 1.5; // +1.5-4%
            } else if (simulationProgress < 95) {
                simulationProgress += Math.floor(Math.random() * 1.5) + 0.5; // +0.5-2%
            } else {
                simulationProgress = 95; // Cap at 95%
            }
        }
        
        updateProgressUI(simulationProgress);
    }, 1000);
}

function updateProgressUI(percent) {
    const loadingText = document.getElementById('loadingText');
    if (loadingText && currentTaskId) {
        const task = getTaskById(currentTaskId);
        let prefix = '正在解析...';
        if (task) {
            if (task.status === STATUS.PENDING) {
                prefix = '排队中...';
            } else if (task.status === STATUS.PROCESSING) {
                prefix = '正在解析...';
            }
        }
        loadingText.textContent = `${prefix} ${Math.floor(percent)}%`;
    }
}

function startPolling(taskId) {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
    }
    if (progressIntervalId) {
        clearInterval(progressIntervalId);
        progressIntervalId = null;
    }
    
    pollStartTime = Date.now();
    startProgressSimulation(taskId);
    
    pollIntervalId = setInterval(async () => {
        // Check timeout
        if (Date.now() - pollStartTime > POLL_TIMEOUT) {
            clearInterval(pollIntervalId);
            if (progressIntervalId) {
                clearInterval(progressIntervalId);
                progressIntervalId = null;
            }
            updateTaskStatus(taskId, STATUS.TIMEOUT);
            showToast('任务超时', 'warning');
            const task = getTaskById(taskId);
            if (currentPage === 'viewer' && currentTaskId === taskId && task) {
                showTaskLoadingStatus(task);
            }
            renderSidebarTasks();
            return;
        }
        
        try {
            const response = await fetch(`/tasks/${taskId}`);
            if (response.status === 404) {
                clearInterval(pollIntervalId);
                if (progressIntervalId) {
                    clearInterval(progressIntervalId);
                    progressIntervalId = null;
                }
                updateTaskStatus(taskId, STATUS.FAILED);
                showToast('任务已失效或服务器重启，请重新解析', 'warning');
                const task = getTaskById(taskId);
                if (currentPage === 'viewer' && currentTaskId === taskId && task) {
                    showTaskLoadingStatus(task);
                }
                renderSidebarTasks();
                return;
            }
            const data = await response.json();

            // Update task with outputDir if available
            if (data.output_dir) {
                updateTaskOutputDir(taskId, data.output_dir);
            }

            updateTaskStatus(taskId, data.status);
            renderSidebarTasks();

            if (data.status === STATUS.COMPLETED) {
                clearInterval(pollIntervalId);
                if (progressIntervalId) {
                    clearInterval(progressIntervalId);
                    progressIntervalId = null;
                }
                updateProgressUI(100);
                showToast('解析完成', 'success');
                if (currentPage === 'viewer' && currentTaskId === taskId) {
                    loadTaskContent(taskId);
                }
            } else if (data.status === STATUS.FAILED) {
                clearInterval(pollIntervalId);
                if (progressIntervalId) {
                    clearInterval(progressIntervalId);
                    progressIntervalId = null;
                }
                showToast('解析失败: ' + (data.error || '未知错误'), 'error');
                const task = getTaskById(taskId);
                if (currentPage === 'viewer' && currentTaskId === taskId && task) {
                    showTaskLoadingStatus(task);
                }
            } else {
                const task = getTaskById(taskId);
                if (currentPage === 'viewer' && currentTaskId === taskId && task) {
                    // Update progress UI status text without resetting percentage
                    updateProgressUI(simulationProgress);
                }
            }
        } catch (error) {
            console.error('Poll error:', error);
        }
    }, POLL_INTERVAL);
}

// ==================== Example Cards ====================
function initExampleCards() {
    document.querySelectorAll('.example-card').forEach(card => {
        card.addEventListener('click', () => {
            const example = card.getAttribute('data-example');
            loadExample(example);
        });
    });
}

async function loadExample(example) {
    try {
        showToast('加载示例...', 'info');
        
        const response = await fetch('/assets/demo.zip');
        if (!response.ok) {
            throw new Error('Demo zip not available');
        }
        
        const bytes = await response.arrayBuffer();
        window.location.hash = '#/viewer/demo';
        
        // Store demo bytes for viewer
        window._demoBytes = bytes;
        
    } catch (error) {
        console.error('Load example error:', error);
        showToast('演示数据暂不可用，请稍后重启服务', 'error');
    }
}

// ==================== Viewer ====================
async function loadDemoContent() {
    if (!window._demoBytes) {
        showToast('演示数据未加载', 'error');
        return;
    }

    try {
        const zip = await JSZip.loadAsync(window._demoBytes);

        // Load PDF
        const pdfFile = zip.file(/\.pdf$/)[0] || zip.file(/origin\.pdf/)[0];
        if (pdfFile) {
            const pdfBytes = await pdfFile.async('arraybuffer');
            await loadPdf(pdfBytes);
            // Show canvas, hide loading
            const container = document.getElementById('canvasContainer');
            if (container) container.style.display = 'block';
            document.getElementById('paneLeftLoading').style.display = 'none';
        }

        // Load middle.json for BBox
        const middleFile = zip.file(/middle\.json$/)[0];
        if (middleFile) {
            const middleContent = await middleFile.async('string');
            middleJson = JSON.parse(middleContent);
        }

        // Find markdown file
        const mdFiles = zip.file(/\.md$/);
        if (mdFiles.length > 0) {
            const mdContent = await mdFiles[0].async('string');
            renderMarkdown(mdContent, zip);
            
            // Show correct container based on active tab
            const activeTab = document.querySelector('.pane-tab.active')?.getAttribute('data-tab') || 'markdown';
            const actions = document.getElementById('paneRightActions');
            if (activeTab === 'markdown') {
                document.getElementById('markdownContent').style.display = 'block';
                if (actions) actions.style.display = 'block';
            } else {
                const jsonContent = document.getElementById('jsonContent');
                if (jsonContent) {
                    jsonContent.style.display = 'block';
                    jsonContent.textContent = middleJson ? JSON.stringify(middleJson, null, 2) : '{}';
                }
                if (actions) actions.style.display = 'none';
            }
            document.getElementById('paneRightLoading').style.display = 'none';
        }

        document.getElementById('viewerTitle').textContent = '示例文档';

    } catch (error) {
        console.error('Load demo error:', error);
        showToast('加载演示失败', 'error');
    }
}

async function loadTaskContent(taskId) {
    try {
        // Show loading states
        document.getElementById('paneLeftLoading').style.display = 'flex';
        document.getElementById('paneRightLoading').style.display = 'flex';
        const container = document.getElementById('canvasContainer');
        if (container) container.style.display = 'none';
        document.getElementById('markdownContent').style.display = 'none';

        const loadingText = document.getElementById('loadingText');
        if (loadingText) {
            loadingText.textContent = '正在加载结果...';
        }

        const response = await fetch(`/tasks/${taskId}/result`);
        if (response.status === 404) {
            updateTaskStatus(taskId, STATUS.FAILED);
            renderSidebarTasks();
            showToast('任务结果未找到，可能已被清理或服务重启', 'error');
            const task = getTaskById(taskId);
            if (task) {
                showTaskLoadingStatus(task);
            }
            return;
        }
        if (!response.ok) {
            throw new Error('Failed to load task result');
        }

        const bytes = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(bytes);

        // Load PDF
        const pdfFile = zip.file(/\.pdf$/)[0] || zip.file(/origin\.pdf/)[0];
        if (pdfFile) {
            const pdfBytes = await pdfFile.async('arraybuffer');
            await loadPdf(pdfBytes);
            const container = document.getElementById('canvasContainer');
            if (container) container.style.display = 'block';
            document.getElementById('paneLeftLoading').style.display = 'none';
        } else {
            // Check for image
            const imageFile = zip.file(/\.(jpg|jpeg|png|gif)$/i)[0];
            if (imageFile) {
                const imageBlob = await imageFile.async('blob');
                currentImageBlob = imageBlob;
                await loadImageToCanvas(imageBlob);
                const container = document.getElementById('canvasContainer');
                if (container) container.style.display = 'block';
                document.getElementById('paneLeftLoading').style.display = 'none';
            }
        }

        // Load middle.json for BBox
        const middleFile = zip.file(/middle\.json$/)[0];
        if (middleFile) {
            const middleContent = await middleFile.async('string');
            middleJson = JSON.parse(middleContent);
        }

        // Find markdown file
        const mdFiles = zip.file(/\.md$/);
        if (mdFiles.length > 0) {
            const mdContent = await mdFiles[0].async('string');
            renderMarkdown(mdContent, zip);
            
            // Show correct container based on active tab
            const activeTab = document.querySelector('.pane-tab.active')?.getAttribute('data-tab') || 'markdown';
            const actions = document.getElementById('paneRightActions');
            if (activeTab === 'markdown') {
                document.getElementById('markdownContent').style.display = 'block';
                if (actions) actions.style.display = 'block';
            } else {
                const jsonContent = document.getElementById('jsonContent');
                if (jsonContent) {
                    jsonContent.style.display = 'block';
                    jsonContent.textContent = middleJson ? JSON.stringify(middleJson, null, 2) : '{}';
                }
                if (actions) actions.style.display = 'none';
            }
            document.getElementById('paneRightLoading').style.display = 'none';
        }

        const task = getTaskById(taskId);
        document.getElementById('viewerTitle').textContent = task ? task.fileName : '文档预览';

    } catch (error) {
        console.error('Load task error:', error);
        showToast('加载任务结果失败', 'error');
        
        // Hide loading overlays on error
        document.getElementById('paneLeftLoading').style.display = 'none';
        document.getElementById('paneRightLoading').style.display = 'none';
        
        const loadingText = document.getElementById('loadingText');
        if (loadingText) {
            loadingText.textContent = '加载任务结果失败';
        }
    }
}

// ==================== PDF.js ====================
async function loadPdf(data) {
    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.min.js';

    try {
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        totalPages = pdfDoc.numPages;
        currentPageNum = 1;

        document.getElementById('totalPages').textContent = totalPages;
        document.getElementById('currentPage').textContent = currentPageNum;

        // Calculate and set auto-fit default zoom level
        try {
            const page = await pdfDoc.getPage(1);
            const pageView = page.view;
            const pw = pageView[2] - pageView[0];
            const ph = pageView[3] - pageView[1];

            const paneBody = document.querySelector('.pane-left .pane-body');
            if (paneBody) {
                const targetWidth = paneBody.clientWidth - 48; // Subtract padding
                const targetHeight = paneBody.clientHeight - 48;

                // Account for current rotation if any
                let unscaledW = pw;
                let unscaledH = ph;
                if (currentRotation === 90 || currentRotation === 270) {
                    unscaledW = ph;
                    unscaledH = pw;
                }

                const zoomW = targetWidth / unscaledW;
                const zoomH = targetHeight / unscaledH;

                currentZoom = Math.max(0.5, Math.min(Math.min(zoomW, zoomH), 2.0));
                
                // Sync UI elements
                document.getElementById('zoomSlider').value = currentZoom * 100;
                document.getElementById('zoomValue').textContent = Math.round(currentZoom * 100) + '%';
            }
        } catch (zoomErr) {
            console.error('Failed to calculate auto-fit zoom:', zoomErr);
            currentZoom = 1.0;
        }

        await renderPage(currentPageNum);
    } catch (error) {
        console.error('PDF load error:', error);
        showToast('PDF 加载失败', 'error');
    }
}

async function renderPage(pageNum) {
    if (pdfDoc) {
        try {
            // Cancel active render task to avoid collisions/exceptions during zoom/navigation
            if (currentRenderTask) {
                currentRenderTask.cancel();
                currentRenderTask = null;
            }

            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({
                scale: currentZoom,
                rotation: currentRotation
            });

            const canvas = document.getElementById('pdfCanvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const container = document.getElementById('canvasContainer');
            if (container) {
                container.style.width = viewport.width + 'px';
                container.style.height = viewport.height + 'px';
            }

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };

            currentRenderTask = page.render(renderContext);

            try {
                await currentRenderTask.promise;
            } catch (err) {
                if (err.name === 'HeadingCancelledException' || err.name === 'RenderingCancelledException') {
                    return; // Ignore cancelled tasks
                }
                throw err;
            } finally {
                currentRenderTask = null;
            }

            // Render BBox overlay
            if (showBBox && middleJson) {
                renderBBoxOverlay(pageNum, viewport, page);
            }

            document.getElementById('currentPage').textContent = pageNum;
        } catch (error) {
            console.error('Page render error:', error);
        }
    } else if (currentImageBlob) {
        await loadImageToCanvas(currentImageBlob);
    }
}

function renderBBoxOverlay(pageNum, viewport, page) {
    const bboxLayer = document.getElementById('bboxLayer');
    bboxLayer.innerHTML = '';

    if (!middleJson) return;

    // Retrieve page layout data dynamically supporting both standard and legacy schemas
    let pageData = null;
    if (middleJson.pdf_info && middleJson.pdf_info[pageNum - 1]) {
        pageData = middleJson.pdf_info[pageNum - 1];
    } else if (Array.isArray(middleJson) && middleJson[pageNum - 1]) {
        pageData = middleJson[pageNum - 1];
    }

    if (!pageData) return;

    let blocks = [];
    if (pageData.preproc_blocks) {
        blocks = pageData.preproc_blocks;
    } else if (pageData.blocks) {
        blocks = pageData.blocks;
    } else if (pageData.bboxes) {
        pageData.bboxes.forEach((bbox, index) => {
            blocks.push({
                bbox: bbox,
                type: pageData.types?.[index] || 'text',
                text: pageData.texts?.[index] || ''
            });
        });
    }

    // Helper to extract nested text from lines and spans
    function getBlockText(block) {
        let textParts = [];
        if (block.lines) {
            block.lines.forEach(line => {
                if (line.spans) {
                    line.spans.forEach(span => {
                        if (span.content) {
                            textParts.push(span.content);
                        } else if (span.html) {
                            textParts.push('[表格内容]');
                        } else if (span.latex) {
                            textParts.push(span.latex);
                        }
                    });
                }
            });
        }
        if (block.blocks) {
            block.blocks.forEach(subBlock => {
                const subText = getBlockText(subBlock);
                if (subText) textParts.push(subText);
            });
        }
        return textParts.join(' ').trim();
    }

    // Get unscaled width and height of the page
    let pw = viewport.width / viewport.scale;
    let ph = viewport.height / viewport.scale;
    if (page && page.view) {
        const pageView = page.view;
        pw = pageView[2] - pageView[0];
        ph = pageView[3] - pageView[1];
    }

    blocks.forEach((block) => {
        const bbox = block.bbox;
        if (!bbox || bbox.length < 4) return;

        const div = document.createElement('div');
        div.className = 'bbox-rect';

        const x_min = bbox[0];
        const y_min = bbox[1];
        const x_max = bbox[2];
        const y_max = bbox[3];

        let left, top, width, height;

        // Handle page rotation (0, 90, 180, 270)
        if (currentRotation === 90) {
            left = (ph - y_max) * viewport.scale;
            top = x_min * viewport.scale;
            width = (y_max - y_min) * viewport.scale;
            height = (x_max - x_min) * viewport.scale;
        } else if (currentRotation === 180) {
            left = (pw - x_max) * viewport.scale;
            top = (ph - y_max) * viewport.scale;
            width = (x_max - x_min) * viewport.scale;
            height = (y_max - y_min) * viewport.scale;
        } else if (currentRotation === 270) {
            left = y_min * viewport.scale;
            top = (pw - x_max) * viewport.scale;
            width = (y_max - y_min) * viewport.scale;
            height = (x_max - x_min) * viewport.scale;
        } else { // 0 degrees
            left = x_min * viewport.scale;
            top = y_min * viewport.scale;
            width = (x_max - x_min) * viewport.scale;
            height = (y_max - y_min) * viewport.scale;
        }

        div.style.left = left + 'px';
        div.style.top = top + 'px';
        div.style.width = width + 'px';
        div.style.height = height + 'px';

        // Color by mapped type
        const rawType = block.type || 'text';
        let type = 'text';
        if (rawType.includes('image') || rawType === 'figure') {
            type = 'image';
        } else if (rawType.includes('table')) {
            type = 'table';
        } else if (rawType.includes('equation') || rawType.includes('formula')) {
            type = 'formula';
        }

        const colors = {
            text: 'rgba(204, 120, 92, 0.25)',
            image: 'rgba(93, 184, 166, 0.25)',
            table: 'rgba(232, 165, 90, 0.25)',
            formula: 'rgba(139, 92, 246, 0.25)'
        };
        const borderColors = {
            text: '#cc785c',
            image: '#5db8a6',
            table: '#e8a55a',
            formula: '#8b5cf6'
        };
        div.style.background = colors[type] || colors.text;
        div.style.borderColor = borderColors[type] || borderColors.text;

        // Tooltip data
        div.dataset.type = type === 'text' ? '文本' : (type === 'image' ? '图片' : (type === 'table' ? '表格' : '公式'));
        div.dataset.text = block.text || getBlockText(block);

        // Hover events
        div.addEventListener('mouseenter', showBBoxTooltip);
        div.addEventListener('mouseleave', hideBBoxTooltip);

        bboxLayer.appendChild(div);
    });
}

function showBBoxTooltip(e) {
    const tooltip = document.getElementById('bboxTooltip');
    const typeEl = document.getElementById('tooltipType');
    const textEl = document.getElementById('tooltipText');

    typeEl.textContent = e.target.dataset.type;
    textEl.textContent = e.target.dataset.text;

    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 10) + 'px';
    tooltip.style.top = (e.clientY + 10) + 'px';
}

function hideBBoxTooltip() {
    document.getElementById('bboxTooltip').style.display = 'none';
}

// ==================== Viewer Controls ====================
function initViewerControls() {
    // Zoom controls
    document.getElementById('btnZoomIn')?.addEventListener('click', () => {
        currentZoom = Math.min(currentZoom + 0.1, 2.0);
        updateZoom();
    });

    document.getElementById('btnZoomOut')?.addEventListener('click', () => {
        currentZoom = Math.max(currentZoom - 0.1, 0.5);
        updateZoom();
    });

    document.getElementById('zoomSlider')?.addEventListener('input', (e) => {
        currentZoom = parseInt(e.target.value) / 100;
        updateZoom();
    });

    // Page controls
    document.getElementById('btnPrevPage')?.addEventListener('click', () => {
        if (currentPageNum > 1) {
            currentPageNum--;
            renderPage(currentPageNum);
        }
    });

    document.getElementById('btnNextPage')?.addEventListener('click', () => {
        if (currentPageNum < totalPages) {
            currentPageNum++;
            renderPage(currentPageNum);
        }
    });

    // Rotate
    document.getElementById('btnRotate')?.addEventListener('click', () => {
        currentRotation = (currentRotation + 90) % 360;
        renderPage(currentPageNum);
    });

    // BBox toggle
    document.getElementById('btnToggleBBox')?.addEventListener('click', () => {
        showBBox = !showBBox;
        const btn = document.getElementById('btnToggleBBox');
        btn.classList.toggle('active', showBBox);
        renderPage(currentPageNum);
    });

    // Back button
    document.getElementById('btnBack')?.addEventListener('click', () => {
        window.location.hash = '#/parse';
    });

    // Open folder
    document.getElementById('btnOpenFolder')?.addEventListener('click', () => {
        if (currentTaskId && currentTaskId !== 'demo') {
            openTaskFolder(currentTaskId);
        }
    });

    // Favorite button
    document.getElementById('btnFavorite')?.addEventListener('click', () => {
        if (currentTaskId && currentTaskId !== 'demo') {
            toggleFavorite(currentTaskId);
            updateFavoriteBtn(currentTaskId);
        }
    });
}

function updateZoom() {
    document.getElementById('zoomSlider').value = currentZoom * 100;
    document.getElementById('zoomValue').textContent = Math.round(currentZoom * 100) + '%';
    renderPage(currentPageNum);
}

// ==================== Markdown + KaTeX ====================
function renderMarkdown(content, zip) {
    const container = document.getElementById('markdownContent');

    // Configure marked with KaTeX
    const renderer = new marked.Renderer();

    // Override code blocks for KaTeX
    const originalCode = renderer.code;
    renderer.code = function(code, language) {
        if (language === 'math' || language === 'latex') {
            try {
                return katex.renderToString(code, { displayMode: true, throwOnError: false });
            } catch (e) {
                return `<pre><code>${escapeHtml(code)}</code></pre>`;
            }
        }
        return originalCode.call(this, code, language);
    };

    marked.setOptions({
        breaks: true,
        gfm: true,
        renderer: renderer
    });

    // Process inline math before rendering
    let processedContent = content.replace(/\$\$(.*?)\$\$/gs, (match, formula) => {
        try {
            return katex.renderToString(formula, { displayMode: true, throwOnError: false });
        } catch (e) {
            return match;
        }
    });

    processedContent = processedContent.replace(/\$(.*?)\$/g, (match, formula) => {
        try {
            return katex.renderToString(formula, { displayMode: false, throwOnError: false });
        } catch (e) {
            return match;
        }
    });

    // --- Smart OCR Artifact Correction ---
    // 1. Convert actual circled numbers if the model happened to recognize them
    const circleMap = {
        '①': '1、', '②': '2、', '③': '3、', '④': '4、', '⑤': '5、',
        '⑥': '6、', '⑦': '7、', '⑧': '8、', '⑨': '9、', '⑩': '10、'
    };
    processedContent = processedContent.replace(/[①-⑩]/g, match => circleMap[match]);

    // Render
    container.innerHTML = marked.parse(processedContent);

    // Apply smart table layouts (Scheme B + Scheme C concepts)
    optimizeTableLayouts(container);

    // Replace image sources with blob URLs
    replaceImageSources(container, zip);
}

function optimizeTableLayouts(container) {
    const tables = container.querySelectorAll('table');
    tables.forEach(table => {
        const cells = table.querySelectorAll('th, td');
        cells.forEach(cell => {
            // Do not override if explicitly aligned
            if (cell.getAttribute('align') || cell.style.textAlign) return;
            
            const text = cell.textContent.trim();
            if (!text) return;
            
            // Heuristic: If text is short (<= 15 characters), it's likely a label or number -> center align
            // If text is long, it's a description -> left align
            if (text.length <= 15) {
                cell.style.textAlign = 'center';
            } else {
                cell.style.textAlign = 'left';
            }
        });
    });
}

async function replaceImageSources(container, zip) {
    const images = container.querySelectorAll('img');

    for (const img of images) {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
            // Try to find in zip
            const file = zip.file(src);
            if (file) {
                const blob = await file.async('blob');
                const url = URL.createObjectURL(blob);
                img.src = url;
            }
        }
    }
}

// ==================== Settings ====================
function initSettings() {
    const modal = document.getElementById('settingsModal');
    const btnSettings = document.getElementById('btnSettings');
    const btnClose = document.getElementById('btnCloseSettings');
    
    // Open settings
    btnSettings.addEventListener('click', () => {
        modal.style.display = 'flex';
        loadSettingsToUI();
    });
    
    // Close settings
    btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Tab navigation
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.getAttribute('data-tab');
            
            // Update active state
            document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Show tab
            document.querySelectorAll('.settings-tab').forEach(t => t.style.display = 'none');
            document.getElementById('tab' + capitalize(tab)).style.display = 'block';
        });
    });
    
    // Save settings on change
    document.querySelectorAll('#tabParams input, #tabParams select').forEach(input => {
        input.addEventListener('change', saveSettingsFromUI);
    });
    
    // Copy user ID
    document.getElementById('btnCopyUserId').addEventListener('click', () => {
        const userId = document.getElementById('userId').textContent;
        navigator.clipboard.writeText(userId).then(() => {
            showToast('已复制用户 ID', 'success');
        });
    });


    // Change directory
    document.getElementById('btnChangeDir').addEventListener('click', () => {
        // In a real app, this would open a directory picker
        showToast('目录选择功能即将上线', 'info');
    });

    // Change model cache directory
    document.getElementById('btnChangeModelDir')?.addEventListener('click', () => {
        // In a real app, this would open a directory picker
        showToast('目录选择功能即将上线', 'info');
    });

    // Model source change - show hint
    document.getElementById('modelSource')?.addEventListener('change', (e) => {
        const hint = document.querySelector('.setting-hint .hint-text');
        if (hint) {
            if (e.target.value === 'modelscope') {
                hint.textContent = '已选择 ModelScope，国内下载速度更快';
            } else {
                hint.textContent = '国内推荐使用 ModelScope，速度更快';
            }
        }
    });

    // Update strategy banner on load
    updateStrategyBanner(getSettings());
}

function loadSettingsToUI() {
    const settings = getSettings();

    // System settings
    document.getElementById('userId').textContent = settings.userId;
    document.getElementById('outputDir').textContent = settings.outputDir;

    // Params settings
    document.querySelector(`input[name="modelVersion"][value="${settings.modelVersion}"]`).checked = true;
    document.getElementById('enableFormula').checked = settings.enableFormula;
    document.getElementById('enableTable').checked = settings.enableTable;
    document.getElementById('forceOcr').checked = settings.forceOcr;
    document.getElementById('language').value = settings.language;

    // Model download settings
    document.getElementById('modelSource').value = settings.modelSource || 'huggingface';
    document.getElementById('modelCacheDir').value = settings.modelCacheDir || '';
}

function saveSettingsFromUI() {
    const settings = {
        modelVersion: document.querySelector('input[name="modelVersion"]:checked').value,
        enableFormula: document.getElementById('enableFormula').checked,
        enableTable: document.getElementById('enableTable').checked,
        forceOcr: document.getElementById('forceOcr').checked,
        language: document.getElementById('language').value,
        outputDir: document.getElementById('outputDir').textContent,
        userId: document.getElementById('userId').textContent,
        modelSource: document.getElementById('modelSource').value,
        modelCacheDir: document.getElementById('modelCacheDir').value
    };

    saveSettings(settings);

    // Apply model source to environment
    applyModelSource(settings.modelSource, settings.modelCacheDir);

    // Update strategy banner
    updateStrategyBanner(settings);

    showToast('设置已保存', 'success');
}

function updateStrategyBanner(settings) {
    const bannerDesc = document.querySelector('.banner-desc');
    if (!bannerDesc) return;
    
    let desc = '';
    switch (settings.modelVersion) {
        case 'vlm':
            desc = '当前模式：VLM（视觉语言模型解析）';
            break;
        case 'hybrid':
            desc = '当前模式：Hybrid（混合布局分析 + 智能解析）';
            break;
        case 'pipeline':
            desc = '当前模式：Pipeline（OCR + 版面分析 + 公式识别）';
            break;
        default:
            desc = '当前模式：Pipeline（OCR + 版面分析 + 公式识别）';
    }
    bannerDesc.textContent = desc;
}

async function applyModelSource(source, cacheDir) {
    // Store in localStorage for backend to read
    localStorage.setItem('mineru.modelSource', source);
    localStorage.setItem('mineru.modelCacheDir', cacheDir || '');

    // Update backend configuration
    try {
        const response = await fetch('/api/model_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, cache_dir: cacheDir || '' })
        });

        if (!response.ok) {
            console.error('Failed to update model config');
        }
    } catch (error) {
        console.error('Error updating model config:', error);
    }
}

// ==================== Keyboard Shortcuts ====================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+O: Open file
        if (e.ctrlKey && e.shiftKey && e.key === 'O') {
            e.preventDefault();
            document.getElementById('fileInput').click();
        }
        
        // Ctrl+Shift+U: Upload
        if (e.ctrlKey && e.shiftKey && e.key === 'U') {
            e.preventDefault();
            window.location.hash = '#/parse';
        }
        
        // Ctrl+Shift+S: Settings
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            document.getElementById('settingsModal').style.display = 'flex';
            loadSettingsToUI();
        }
        
        // ESC: Close modal
        if (e.key === 'Escape') {
            document.getElementById('settingsModal').style.display = 'none';
        }
    });
}

// ==================== Tasks Table ====================
let tasksCurrentPage = 1;
let tasksPageSize = 10;

function renderTasksTable() {
    const tasks = getTasks();
    const tbody = document.getElementById('tasksTableBody');
    const empty = document.getElementById('tasksEmpty');
    const totalTasks = document.getElementById('totalTasks');

    // Apply filters
    const searchTerm = document.getElementById('taskSearch')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';

    let filtered = tasks.filter(task => {
        const matchSearch = !searchTerm || task.fileName.toLowerCase().includes(searchTerm);
        const matchStatus = statusFilter === 'all' || task.status === statusFilter;
        return matchSearch && matchStatus;
    });

    totalTasks.textContent = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';

    // Sort by createdAt descending
    const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

    // Pagination
    const totalPages = Math.ceil(sorted.length / tasksPageSize);
    const startIdx = (tasksCurrentPage - 1) * tasksPageSize;
    const pageTasks = sorted.slice(startIdx, startIdx + tasksPageSize);

    tbody.innerHTML = pageTasks.map(task => `
        <tr>
            <td>${escapeHtml(task.fileName)}</td>
            <td>${formatFileSize(task.fileSize)}</td>
            <td>
                <span class="status-badge ${task.status}">
                    ${getStatusLabel(task.status)}
                </span>
            </td>
            <td>${formatDateTime(task.createdAt)}</td>
            <td>
                <div class="task-actions">
                    ${task.status === STATUS.COMPLETED ? `
                        <button class="btn btn-sm" onclick="window.location.hash='#/viewer/${task.taskId}'">查看</button>
                        <button class="btn btn-sm" onclick="openTaskFolder('${task.taskId}')">打开文件夹</button>
                    ` : ''}
                    <button class="btn btn-sm btn-danger" onclick="deleteTask('${task.taskId}')">删除</button>
                </div>
            </td>
        </tr>
    `).join('');

    // Render pagination
    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const pageNumbers = document.getElementById('pageNumbers');
    if (!pageNumbers) return;

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<span class="page-num ${i === tasksCurrentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</span>`;
    }
    pageNumbers.innerHTML = html;

    // Update prev/next buttons
    const btnPrev = document.querySelector('#tasksPagination .btn-icon-only:first-of-type');
    const btnNext = document.querySelector('#tasksPagination .btn-icon-only:last-of-type');
    if (btnPrev) btnPrev.disabled = tasksCurrentPage <= 1;
    if (btnNext) btnNext.disabled = tasksCurrentPage >= totalPages;
}

function goToPage(page) {
    tasksCurrentPage = page;
    renderTasksTable();
}

function initTasksPage() {
    // Search
    document.getElementById('taskSearch')?.addEventListener('input', () => {
        tasksCurrentPage = 1;
        renderTasksTable();
    });

    // Status filter
    document.getElementById('statusFilter')?.addEventListener('change', () => {
        tasksCurrentPage = 1;
        renderTasksTable();
    });

    // Page size
    document.getElementById('pageSize')?.addEventListener('change', (e) => {
        tasksPageSize = parseInt(e.target.value);
        tasksCurrentPage = 1;
        renderTasksTable();
    });

    // Start parse button
    document.getElementById('btnStartParse')?.addEventListener('click', () => {
        window.location.hash = '#/parse';
    });
}

async function openTaskFolder(taskId) {
    const task = getTaskById(taskId);
    if (!task || !task.outputDir) {
        showToast('任务输出目录不存在', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/open_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: task.outputDir })
        });
        
        if (response.ok) {
            showToast('已打开文件夹', 'success');
        } else {
            showToast('路径已失效', 'error');
        }
    } catch (error) {
        showToast('打开文件夹失败', 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('确定要删除该任务及其所有相关文件吗？\n删除后不可恢复。')) {
        return;
    }
    
    try {
        const response = await fetch(`/tasks/${taskId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok && response.status !== 404) {
            console.error('Failed to delete task from backend');
        }
    } catch (e) {
        console.error('Error deleting task:', e);
    }

    const tasks = getTasks().filter(t => t.taskId !== taskId);
    saveTasks(tasks);
    renderTasksTable();
    renderSidebarTasks();
    
    if (currentTaskId === taskId) {
        window.location.hash = '#/parse';
    }
    
    showToast('任务及文件已删除', 'success');
}

// ==================== Storage ====================
function getTasks() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.TASKS);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
}

function getTaskById(taskId) {
    return getTasks().find(t => t.taskId === taskId);
}

function saveTask(task) {
    const tasks = getTasks();
    const index = tasks.findIndex(t => t.taskId === task.taskId);
    
    if (index >= 0) {
        tasks[index] = { ...tasks[index], ...task };
    } else {
        tasks.push(task);
    }
    
    saveTasks(tasks);
}

function updateTaskStatus(taskId, status) {
    const tasks = getTasks();
    const task = tasks.find(t => t.taskId === taskId);

    if (task) {
        task.status = status;
        saveTasks(tasks);
    }
}

function updateTaskOutputDir(taskId, outputDir) {
    const tasks = getTasks();
    const task = tasks.find(t => t.taskId === taskId);

    if (task) {
        task.outputDir = outputDir;
        saveTasks(tasks);
    }
}

function getSettings() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

// ==================== Toast ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Auto remove after 3s
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ==================== Utilities ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    
    return date.toLocaleDateString('zh-CN');
}

function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getStatusLabel(status) {
    const labels = {
        pending: '等待中',
        processing: '处理中',
        completed: '已完成',
        failed: '失败',
        timeout: '超时'
    };
    return labels[status] || status;
}

// Draw image onto the canvas and scale coordinates accordingly
function loadImageToCanvas(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.getElementById('pdfCanvas');
            const ctx = canvas.getContext('2d');
            
            // Calculate and set auto-fit default zoom level
            const paneBody = document.querySelector('.pane-left .pane-body');
            if (paneBody) {
                const targetWidth = paneBody.clientWidth - 48; // Subtract padding
                const targetHeight = paneBody.clientHeight - 48;

                const zoomW = targetWidth / img.width;
                const zoomH = targetHeight / img.height;

                currentZoom = Math.max(0.5, Math.min(Math.min(zoomW, zoomH), 2.0));
                
                // Sync UI elements
                document.getElementById('zoomSlider').value = currentZoom * 100;
                document.getElementById('zoomValue').textContent = Math.round(currentZoom * 100) + '%';
            }

            const scale = currentZoom;
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;

            const container = document.getElementById('canvasContainer');
            if (container) {
                container.style.width = canvas.width + 'px';
                container.style.height = canvas.height + 'px';
            }
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            totalPages = 1;
            currentPageNum = 1;
            document.getElementById('totalPages').textContent = totalPages;
            document.getElementById('currentPage').textContent = currentPageNum;
            
            if (showBBox && middleJson) {
                const viewport = {
                    width: canvas.width,
                    height: canvas.height,
                    scale: scale
                };
                renderBBoxOverlay(1, viewport);
            }
            
            URL.revokeObjectURL(url);
            resolve();
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

// Show processing status on the viewer page
function showTaskLoadingStatus(task) {
    document.getElementById('paneLeftLoading').style.display = 'flex';
    const container = document.getElementById('canvasContainer');
    if (container) container.style.display = 'none';

    const rightLoading = document.getElementById('paneRightLoading');
    rightLoading.style.display = 'flex';
    document.getElementById('markdownContent').style.display = 'none';
    
    const jsonContent = document.getElementById('jsonContent');
    if (jsonContent) jsonContent.style.display = 'none';

    const actions = document.getElementById('paneRightActions');
    if (actions) actions.style.display = 'none';

    const loadingText = document.getElementById('loadingText');
    if (task.status === STATUS.PENDING) {
        loadingText.textContent = '排队中...';
    } else if (task.status === STATUS.PROCESSING) {
        loadingText.textContent = '正在解析...';
    } else if (task.status === STATUS.FAILED) {
        loadingText.textContent = '解析失败';
    } else if (task.status === STATUS.TIMEOUT) {
        loadingText.textContent = '解析超时';
    } else {
        loadingText.textContent = getStatusLabel(task.status) + '...';
    }
}

// Handle viewer tab switching
function initViewerTabs() {
    // Add event listener for PDF export
    document.getElementById('btnDownloadPdf')?.addEventListener('click', () => {
        printMarkdownToPdf();
    });

    document.querySelectorAll('.pane-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            
            document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const mdContent = document.getElementById('markdownContent');
            const jsonContent = document.getElementById('jsonContent');
            const actions = document.getElementById('paneRightActions');
            
            if (target === 'markdown') {
                mdContent.style.display = 'block';
                if (jsonContent) jsonContent.style.display = 'none';
                if (actions) actions.style.display = 'block';
            } else if (target === 'json') {
                mdContent.style.display = 'none';
                if (jsonContent) {
                    jsonContent.style.display = 'block';
                    jsonContent.textContent = middleJson ? JSON.stringify(middleJson, null, 2) : '{}';
                }
                if (actions) actions.style.display = 'none';
            }
        });
    });
}

// Print and export Markdown content to PDF
function printMarkdownToPdf() {
    const mdContent = document.getElementById('markdownContent');
    if (!mdContent || mdContent.style.display === 'none') {
        showToast('请先切换到 Markdown 预览再进行打印/导出', 'warning');
        return;
    }
    
    showToast('正在打开打印预览页面...', 'info');

    // Open a new tab
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
        showToast('新窗口被浏览器拦截，请允许弹窗以查看打印预览', 'error');
        return;
    }

    const doc = previewWindow.document;
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>打印预览 - ${document.getElementById('viewerTitle')?.textContent || '文档'}</title>
            <meta charset="UTF-8">
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
            <link rel="stylesheet" href="/lib/katex.min.css">
            <link rel="stylesheet" href="/style.css">
            <style>
                /* Override parent site's overflow: hidden to enable scrolling */
                html, body {
                    overflow: auto !important;
                    height: auto !important;
                }
                
                /* Modern Floating Toolbar */
                .print-toolbar {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 60px;
                    background: rgba(24, 23, 21, 0.95);
                    backdrop-filter: blur(10px);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 24px;
                    z-index: 9999;
                    color: #fff;
                    font-family: 'Inter', sans-serif;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                }
                .print-toolbar-title {
                    font-size: 1.1rem;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 35%;
                }
                .print-toolbar-center {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .print-toolbar-actions {
                    display: flex;
                    gap: 12px;
                }
                .print-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                }
                .print-btn-primary {
                    background: #cc785c;
                    border-color: #cc785c;
                    color: #fff;
                }
                .print-btn-primary:hover {
                    background: #b86a4e;
                    border-color: #b86a4e;
                    transform: translateY(-1px);
                }
                .print-btn-secondary {
                    background: rgba(255, 255, 255, 0.1);
                    color: rgba(255, 255, 255, 0.9);
                    border-color: transparent;
                }
                .print-btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.2);
                    color: #fff;
                }
                .zoom-val {
                    font-size: 0.95rem;
                    min-width: 48px;
                    text-align: center;
                    font-weight: 500;
                }
                
                /* Document Canvas Preview */
                body {
                    background: #f7f6f0;
                    margin: 0;
                    padding: 0;
                    padding-top: 80px;
                    padding-bottom: 40px;
                    display: flex;
                    justify-content: center;
                    min-height: 100vh;
                    box-sizing: border-box;
                }
                .print-preview-container {
                    background: #fff;
                    width: 210mm; /* A4 width */
                    min-height: 297mm; /* A4 height */
                    padding: 2.5cm 2cm;
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.05);
                    border-radius: 4px;
                    box-sizing: border-box;
                }
                
                /* Print layouts */
                @media print {
                    .print-toolbar {
                        display: none !important;
                    }
                    body {
                        background: #fff !important;
                        padding-top: 0 !important;
                        padding-bottom: 0 !important;
                    }
                    .print-preview-container {
                        width: 100% !important;
                        box-shadow: none !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        border-radius: 0 !important;
                        zoom: 1 !important; /* Reset zoom to 100% on printing */
                    }
                }
            </style>
        </head>
        <body>
            <div class="print-toolbar">
                <div class="print-toolbar-title">📄 打印预览：${document.getElementById('viewerTitle')?.textContent || '未命名文档'}</div>
                <div class="print-toolbar-center">
                    <button class="print-btn print-btn-secondary" onclick="changeZoom(-0.1)" title="缩小">−</button>
                    <span class="zoom-val" id="zoomVal">100%</span>
                    <button class="print-btn print-btn-secondary" onclick="changeZoom(0.1)" title="放大">+</button>
                </div>
                <div class="print-toolbar-actions">
                    <button class="print-btn print-btn-primary" onclick="window.print()">
                        <span>🖨️</span>
                        <span>打印 / 另存为 PDF</span>
                    </button>
                    <button class="print-btn print-btn-secondary" onclick="window.close()">
                        <span>关闭预览</span>
                    </button>
                </div>
            </div>
            <div class="print-preview-container" id="previewContainer">
                <div class="markdown-content">
                    ${mdContent.innerHTML}
                </div>
            </div>
            
            <script>
                let zoom = 1.0;
                window.changeZoom = function(delta) {
                    zoom = Math.max(0.5, Math.min(2.0, zoom + delta));
                    document.getElementById('previewContainer').style.zoom = zoom;
                    document.getElementById('zoomVal').textContent = Math.round(zoom * 100) + '%';
                };
            <\/script>
        </body>
        </html>
    `);
    doc.close();
}

// Expose functions called by inline HTML event handlers
window.navigateToTask = navigateToTask;
window.openTaskFolder = openTaskFolder;
window.deleteTask = deleteTask;
window.goToPage = goToPage;

// ==================== Favorites ====================
function toggleFavorite(taskId) {
    const tasks = getTasks();
    const task = tasks.find(t => t.taskId === taskId);
    if (task) {
        task.isFavorite = !task.isFavorite;
        saveTasks(tasks);
        showToast(task.isFavorite ? '已加入收藏' : '已取消收藏', 'success');
        renderSidebarTasks();
    }
}

function updateFavoriteBtn(taskId) {
    const btn = document.getElementById('btnFavorite');
    if (!btn) return;
    
    if (taskId === 'demo') {
        btn.textContent = '☆';
        btn.title = '收藏';
        btn.style.display = 'none';
        return;
    } else {
        btn.style.display = 'inline-flex';
    }
    
    const task = getTaskById(taskId);
    if (task && task.isFavorite) {
        btn.textContent = '★';
        btn.title = '取消收藏';
        btn.style.color = 'var(--amber)';
    } else {
        btn.textContent = '☆';
        btn.title = '收藏';
        btn.style.color = '';
    }
}

function renderFavoritesTable() {
    const tasks = getTasks();
    const favorited = tasks.filter(t => t.isFavorite);

    const empty = document.getElementById('favoritesEmpty');
    const tableContainer = document.getElementById('favoritesTableContainer');
    const tbody = document.getElementById('favoritesTableBody');

    if (favorited.length === 0) {
        if (tableContainer) tableContainer.style.display = 'none';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    const sorted = [...favorited].sort((a, b) => b.createdAt - a.createdAt);

    tbody.innerHTML = sorted.map(task => `
        <tr>
            <td>${escapeHtml(task.fileName)}</td>
            <td>${formatFileSize(task.fileSize)}</td>
            <td>
                <span class="status-badge ${task.status}">
                    ${getStatusLabel(task.status)}
                </span>
            </td>
            <td>${formatDateTime(task.createdAt)}</td>
            <td>
                <div class="task-actions">
                    ${task.status === STATUS.COMPLETED ? `
                        <button class="btn btn-sm" onclick="window.location.hash='#/viewer/${task.taskId}'">查看</button>
                        <button class="btn btn-sm" onclick="openTaskFolder('${task.taskId}')">打开文件夹</button>
                    ` : ''}
                    <button class="btn btn-sm" onclick="toggleFavoriteFromTable('${task.taskId}')">取消收藏</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTask('${task.taskId}')">删除</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function toggleFavoriteFromTable(taskId) {
    toggleFavorite(taskId);
    renderFavoritesTable();
}

window.toggleFavorite = toggleFavorite;
window.updateFavoriteBtn = updateFavoriteBtn;
window.renderFavoritesTable = renderFavoritesTable;
window.toggleFavoriteFromTable = toggleFavoriteFromTable;
