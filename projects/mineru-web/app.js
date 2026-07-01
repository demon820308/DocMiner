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
    outputDir: '~/DocMiner/output',
    userId: '-',
    modelSource: 'huggingface',
    modelCacheDir: '',
    enableNotificationSound: true,
    llmEnable: false,
    llmApiKey: '',
    llmBaseUrl: '',
    llmModel: '',
    llmEnableThinking: false
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
let currentMdContent = '';
let homeDir = '';

// ==================== DOM Ready ====================
document.addEventListener('DOMContentLoaded', () => {
    if (window.electronAPI && window.electronAPI.getHomeDir) {
        window.electronAPI.getHomeDir().then(dir => {
            homeDir = dir;
        }).catch(err => {
            console.error('Failed to get home dir:', err);
        });
    }
    
    // Sync settings to backend on startup
    const settings = getSettings();
    applyModelSource(
        settings.modelSource || 'huggingface', 
        settings.modelCacheDir || '',
        settings.llmEnable || false,
        settings.llmApiKey || '',
        settings.llmBaseUrl || '',
        settings.llmModel || '',
        settings.llmEnableThinking || false
    );

    // Check for any active downloads on startup
    startModelDownloadPolling();

    initAppVersion();
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
        
        const settings = getSettings();
        let subtext = '';
        if (settings.modelSource !== 'local') {
            subtext = '<br><span style="font-size: 12px; color: var(--text-secondary); margin-top: 8px; display: inline-block;">(首次运行可能需要在后台下载模型 2-3GB，请耐心等待，切勿关闭程序)</span>';
        }
        
        loadingText.innerHTML = `${prefix} ${Math.floor(percent)}%${subtext}`;
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
                
                const settings = getSettings();
                if (settings.enableNotificationSound !== false) {
                    playDingSound();
                }

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
    currentMdContent = content || '';
    const container = document.getElementById('markdownContent');
    if (!content) {
        container.innerHTML = '';
        return;
    }

    // Collapse multiple consecutive newlines (3 or more) to standard double newlines
    let processedContent = content.replace(/\r\n/g, '\n');
    processedContent = processedContent.replace(/\n\s*\n(\s*\n)+/g, '\n\n');

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
    processedContent = processedContent.replace(/\$\$(.*?)\$\$/gs, (match, formula) => {
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
    document.getElementById('btnChangeDir').addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.selectDirectory) {
            const dir = await window.electronAPI.selectDirectory('选择保存路径');
            if (dir) {
                document.getElementById('outputDir').textContent = dir;
                saveSettingsFromUI();
            }
        } else {
            showToast('仅在桌面客户端中支持该功能', 'info');
        }
    });

    // Change model cache directory
    document.getElementById('btnChangeModelDir')?.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.selectDirectory) {
            const dir = await window.electronAPI.selectDirectory('选择自定义缓存目录');
            if (dir) {
                document.getElementById('modelCacheDir').value = dir;
                saveSettingsFromUI();
            }
        } else {
            showToast('仅在桌面客户端中支持该功能', 'info');
        }
    });



    // Model source change - show hint & toggle local path fields
    document.getElementById('modelSource')?.addEventListener('change', (e) => {
        const source = e.target.value;
        toggleLocalDirFields(source);
        const hint = document.querySelector('.setting-hint .hint-text');
        if (hint) {
            if (source === 'modelscope') {
                hint.textContent = '已选择 ModelScope，国内下载速度更快';
            } else if (source === 'local') {
                hint.textContent = '已选择本地模型，请指定模型所在的本地目录';
            } else {
                hint.textContent = '国内推荐使用 ModelScope，速度更快';
            }
        }
    });

    // Toggle LLM settings visibility
    document.getElementById('llmEnable')?.addEventListener('change', (e) => {
        toggleLlmFields(e.target.checked);
    });

    // Auto-fetch remote models on key/url change or blur
    document.getElementById('llmApiKey')?.addEventListener('blur', () => {
        triggerModelFetch();
    });
    document.getElementById('llmBaseUrl')?.addEventListener('blur', () => {
        triggerModelFetch();
    });

    // Custom model name text input toggle
    document.getElementById('btnToggleCustomModel')?.addEventListener('click', () => {
        const select = document.getElementById('llmModel');
        const customInput = document.getElementById('llmModelCustom');
        const btn = document.getElementById('btnToggleCustomModel');
        if (select && customInput && btn) {
            if (select.style.display === 'none') {
                select.style.display = 'block';
                customInput.style.display = 'none';
                btn.textContent = '自定义';
            } else {
                select.style.display = 'none';
                customInput.style.display = 'block';
                btn.textContent = '下拉选择';
            }
        }
    });

    // Start download for Pipeline Model
    document.getElementById('btnDownloadPipelineModel')?.addEventListener('click', () => {
        startModelDownload('pipeline');
    });

    // Start download for VLM Model
    document.getElementById('btnDownloadVlmModel')?.addEventListener('click', () => {
        startModelDownload('vlm');
    });

    // Update strategy banner on load
    updateStrategyBanner(getSettings());

    // Initialize software update logic
    initUpdateLogic();
}

function toggleLocalDirFields(source) {
    const cacheContainer = document.getElementById('modelCacheDirContainer');
    const downloadManagerContainer = document.getElementById('modelDownloadManagerContainer');
    
    if (cacheContainer) cacheContainer.style.display = 'flex';
    if (downloadManagerContainer) downloadManagerContainer.style.display = 'flex';
    
    checkOfflineModelsStatus();
}

function toggleLlmFields(enable) {
    const container = document.getElementById('llmConfigContainer');
    if (container) {
        container.style.display = enable ? 'flex' : 'none';
    }
}

async function triggerModelFetch(silent = false) {
    const apiKey = document.getElementById('llmApiKey')?.value || '';
    const baseUrl = document.getElementById('llmBaseUrl')?.value || '';
    
    if (!apiKey || !baseUrl) {
        return; // Only fetch when both are present
    }
    
    const select = document.getElementById('llmModel');
    if (!select) return;
    
    // Save current selected model
    const currentModel = select.value || getSettings().llmModel || '';
    
    // Set loading state in UI
    select.innerHTML = '<option value="">正在获取可用模型列表...</option>';
    select.disabled = true;
    
    try {
        const response = await fetch('/api/fetch_llm_models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, base_url: baseUrl })
        });
        
        if (!response.ok) {
            throw new Error('Remote models API returned error');
        }
        
        const data = await response.json();
        const models = data.models || [];
        
        if (models.length === 0) {
            throw new Error('No models found');
        }
        
        // Populate options
        select.innerHTML = '';
        models.forEach(modelId => {
            const opt = document.createElement('option');
            opt.value = modelId;
            opt.textContent = modelId;
            select.appendChild(opt);
        });
        
        // Restore previous selection if possible
        if (currentModel && models.includes(currentModel)) {
            select.value = currentModel;
        } else if (models.length > 0) {
            select.value = models[0];
        }
        
        if (!silent) {
            showToast('已同步获取可用模型列表', 'success');
        }
    } catch (err) {
        console.error('Failed to sync remote models:', err);
        if (!silent) {
            showToast('获取云端模型列表失败，使用常用默认模型列表', 'warning');
        }
        
        // Fallback to common OpenAI / DeepSeek / Qwen model names
        const fallbacks = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'qwen-plus', 'qwen-max'];
        select.innerHTML = '';
        fallbacks.forEach(modelId => {
            const opt = document.createElement('option');
            opt.value = modelId;
            opt.textContent = modelId;
            select.appendChild(opt);
        });
        
        if (currentModel && fallbacks.includes(currentModel)) {
            select.value = currentModel;
        } else {
            select.value = fallbacks[0];
        }
    } finally {
        select.disabled = false;
        if (!silent) {
            saveSettingsFromUI();
        }
    }
}

let modelDownloadPollIntervalId = null;

async function checkOfflineModelsStatus() {
    try {
        const response = await fetch('/api/offline_models_status');
        if (!response.ok) return;
        const data = await response.json();
        
        const pipelineStatus = document.getElementById('pipelineModelStatus');
        const pipelinePath = document.getElementById('pipelineModelPath');
        const btnPipeline = document.getElementById('btnDownloadPipelineModel');
        
        const vlmStatus = document.getElementById('vlmModelStatus');
        const vlmPath = document.getElementById('vlmModelPath');
        const btnVlm = document.getElementById('btnDownloadVlmModel');
        
        if (data.pipeline) {
            if (data.pipeline.downloaded) {
                if (pipelineStatus) {
                    pipelineStatus.textContent = '已下载';
                    pipelineStatus.style.color = 'var(--success-color, #22c55e)';
                }
                if (pipelinePath) pipelinePath.textContent = data.pipeline.path;
                if (btnPipeline) {
                    btnPipeline.textContent = '重新下载';
                    btnPipeline.disabled = false;
                }
                

            } else {
                if (pipelineStatus) {
                    pipelineStatus.textContent = '未下载';
                    pipelineStatus.style.color = 'var(--warning-color, #eab308)';
                }
                if (pipelinePath) pipelinePath.textContent = '';
                if (btnPipeline) {
                    btnPipeline.textContent = '开始下载';
                    btnPipeline.disabled = false;
                }
            }
        }
        
        if (data.vlm) {
            if (data.vlm.downloaded) {
                if (vlmStatus) {
                    vlmStatus.textContent = '已下载';
                    vlmStatus.style.color = 'var(--success-color, #22c55e)';
                }
                if (vlmPath) vlmPath.textContent = data.vlm.path;
                if (btnVlm) {
                    btnVlm.textContent = '重新下载';
                    btnVlm.disabled = false;
                }
                

            } else {
                if (vlmStatus) {
                    vlmStatus.textContent = '未下载';
                    vlmStatus.style.color = 'var(--warning-color, #eab308)';
                }
                if (vlmPath) vlmPath.textContent = '';
                if (btnVlm) {
                    btnVlm.textContent = '开始下载';
                    btnVlm.disabled = false;
                }
            }
        }
    } catch (err) {
        console.error('Error checking offline models status:', err);
    }
}

async function startModelDownload(modelType) {
    const settings = getSettings();
    const source = settings.modelSource || 'modelscope';
    
    // Disable buttons
    const btnPipeline = document.getElementById('btnDownloadPipelineModel');
    const btnVlm = document.getElementById('btnDownloadVlmModel');
    if (btnPipeline) btnPipeline.disabled = true;
    if (btnVlm) btnVlm.disabled = true;
    
    // Update status UI
    const statusId = modelType === 'pipeline' ? 'pipelineModelStatus' : 'vlmModelStatus';
    const statusElement = document.getElementById(statusId);
    if (statusElement) {
        statusElement.textContent = '正在下载...';
        statusElement.style.color = 'var(--info-color, #3b82f6)';
    }
    
    try {
        const response = await fetch('/api/download_models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_type: modelType, source: source })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || 'Failed to start download');
        }
        
        showToast(`已提交 ${modelType === 'pipeline' ? 'Pipeline' : 'VLM'} 模型下载任务至后台，正在下载...`, 'success');
        startModelDownloadPolling();
    } catch (err) {
        showToast('启动下载失败: ' + err.message, 'error');
        checkOfflineModelsStatus();
    }
}

function startModelDownloadPolling() {
    if (modelDownloadPollIntervalId) {
        clearInterval(modelDownloadPollIntervalId);
    }
    
    // Perform initial fetch to verify status immediately
    fetchStatusAndUpdate();
    
    modelDownloadPollIntervalId = setInterval(fetchStatusAndUpdate, 2000);
    
    async function fetchStatusAndUpdate() {
        try {
            const response = await fetch('/api/download_status');
            if (!response.ok) return;
            const data = await response.json();
            
            if (data.status === 'downloading') {
                // Update download status UI
                const modelType = data.model_type;
                const statusId = modelType === 'pipeline' ? 'pipelineModelStatus' : 'vlmModelStatus';
                const statusElement = document.getElementById(statusId);
                const btnId = modelType === 'pipeline' ? 'btnDownloadPipelineModel' : 'btnDownloadVlmModel';
                const btnElement = document.getElementById(btnId);
                
                if (statusElement) {
                    statusElement.textContent = '正在下载...';
                    statusElement.style.color = 'var(--info-color, #3b82f6)';
                }
                if (btnElement) {
                    btnElement.disabled = true;
                }
                
                // Disable the other button as well
                const otherBtnId = modelType === 'pipeline' ? 'btnDownloadVlmModel' : 'btnDownloadPipelineModel';
                const otherBtnElement = document.getElementById(otherBtnId);
                if (otherBtnElement) otherBtnElement.disabled = true;
                
            } else if (data.status === 'completed') {
                if (modelDownloadPollIntervalId) {
                    clearInterval(modelDownloadPollIntervalId);
                    modelDownloadPollIntervalId = null;
                }
                showToast('后台模型下载完成！已更新配置。', 'success');
                checkOfflineModelsStatus();
            } else if (data.status === 'failed') {
                if (modelDownloadPollIntervalId) {
                    clearInterval(modelDownloadPollIntervalId);
                    modelDownloadPollIntervalId = null;
                }
                showToast('模型下载失败: ' + (data.error || '未知错误'), 'error');
                checkOfflineModelsStatus();
            } else {
                // idle
                if (modelDownloadPollIntervalId) {
                    clearInterval(modelDownloadPollIntervalId);
                    modelDownloadPollIntervalId = null;
                }
                checkOfflineModelsStatus();
            }
        } catch (err) {
            console.error('Error polling model download status:', err);
        }
    }
}

async function loadSettingsToUI() {
    const settings = getSettings();

    // System settings
    document.getElementById('userId').textContent = settings.userId;
    
    let displayDir = settings.outputDir;
    if (displayDir.startsWith('~/')) {
        displayDir = homeDir ? displayDir.replace('~', homeDir) : displayDir;
    }
    if (navigator.userAgent.includes('Windows')) {
        displayDir = displayDir.replace(/\//g, '\\');
    }
    document.getElementById('outputDir').textContent = displayDir;

    // Params settings
    document.querySelector(`input[name="modelVersion"][value="${settings.modelVersion}"]`).checked = true;
    document.getElementById('enableFormula').checked = settings.enableFormula;
    document.getElementById('enableTable').checked = settings.enableTable;
    document.getElementById('forceOcr').checked = settings.forceOcr;
    document.getElementById('language').value = settings.language;
    document.getElementById('enableNotificationSound').checked = settings.enableNotificationSound !== false;

    // Model download settings
    document.getElementById('modelSource').value = settings.modelSource || 'huggingface';
    document.getElementById('modelCacheDir').value = settings.modelCacheDir || '';
    
    // LLM settings
    const llmEnableInput = document.getElementById('llmEnable');
    if (llmEnableInput) llmEnableInput.checked = settings.llmEnable || false;
    const llmApiKeyInput = document.getElementById('llmApiKey');
    if (llmApiKeyInput) llmApiKeyInput.value = settings.llmApiKey || '';
    const llmBaseUrlInput = document.getElementById('llmBaseUrl');
    if (llmBaseUrlInput) llmBaseUrlInput.value = settings.llmBaseUrl || '';
    
    // Render model dropdown
    const select = document.getElementById('llmModel');
    const customInput = document.getElementById('llmModelCustom');
    const btnToggle = document.getElementById('btnToggleCustomModel');
    const savedModel = settings.llmModel || '';
    
    if (select && customInput && btnToggle) {
        const defaults = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'qwen-plus', 'qwen-max'];
        select.innerHTML = '';
        defaults.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            select.appendChild(opt);
        });
        
        if (savedModel) {
            if (defaults.includes(savedModel)) {
                select.value = savedModel;
                select.style.display = 'block';
                customInput.style.display = 'none';
                btnToggle.textContent = '自定义';
            } else {
                // If it is custom, add it as a select option and toggle custom input layout
                const opt = document.createElement('option');
                opt.value = savedModel;
                opt.textContent = savedModel;
                select.appendChild(opt);
                select.value = savedModel;
                
                select.style.display = 'none';
                customInput.style.display = 'block';
                customInput.value = savedModel;
                btnToggle.textContent = '下拉选择';
            }
        } else {
            select.value = defaults[0];
            select.style.display = 'block';
            customInput.style.display = 'none';
            btnToggle.textContent = '自定义';
        }
    }
    
    const llmEnableThinkingInput = document.getElementById('llmEnableThinking');
    if (llmEnableThinkingInput) llmEnableThinkingInput.checked = settings.llmEnableThinking || false;
    
    toggleLocalDirFields(settings.modelSource || 'huggingface');
    toggleLlmFields(settings.llmEnable || false);

    // Sync from backend mineru.json config
    try {
        const response = await fetch('/api/model_config');
        if (response.ok) {
            const backendConfig = await response.json();
            
            document.getElementById('modelSource').value = backendConfig.source || 'huggingface';
            document.getElementById('modelCacheDir').value = backendConfig.cache_dir || '';
            
            if (llmEnableInput) llmEnableInput.checked = backendConfig.llm_enable || false;
            if (llmApiKeyInput) llmApiKeyInput.value = backendConfig.llm_api_key || '';
            if (llmBaseUrlInput) llmBaseUrlInput.value = backendConfig.llm_base_url || '';
            
            const bModel = backendConfig.llm_model || '';
            if (select && customInput && btnToggle) {
                if (backendConfig.llm_api_key && backendConfig.llm_base_url) {
                    // Fetch remote model list silently
                    await triggerModelFetch(true);
                    
                    // After sync, check if bModel exists in select options
                    let found = false;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === bModel) {
                            found = true;
                            break;
                        }
                    }
                    
                    if (found) {
                        select.value = bModel;
                        select.style.display = 'block';
                        customInput.style.display = 'none';
                        btnToggle.textContent = '自定义';
                    } else if (bModel) {
                        customInput.value = bModel;
                        select.style.display = 'none';
                        customInput.style.display = 'block';
                        btnToggle.textContent = '下拉选择';
                    }
                } else if (bModel) {
                    const defaults = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'qwen-plus', 'qwen-max'];
                    if (defaults.includes(bModel)) {
                        select.value = bModel;
                        select.style.display = 'block';
                        customInput.style.display = 'none';
                        btnToggle.textContent = '自定义';
                    } else {
                        customInput.value = bModel;
                        select.style.display = 'none';
                        customInput.style.display = 'block';
                        btnToggle.textContent = '下拉选择';
                    }
                }
            }
            
            if (llmEnableThinkingInput) llmEnableThinkingInput.checked = backendConfig.llm_enable_thinking || false;
            
            toggleLocalDirFields(backendConfig.source || 'huggingface');
            toggleLlmFields(backendConfig.llm_enable || false);
            
            // Silently sync settings to localStorage
            const updatedSettings = {
                ...getSettings(),
                modelSource: backendConfig.source,
                modelCacheDir: backendConfig.cache_dir,
                llmEnable: backendConfig.llm_enable,
                llmApiKey: backendConfig.llm_api_key,
                llmBaseUrl: backendConfig.llm_base_url,
                llmModel: bModel,
                llmEnableThinking: backendConfig.llm_enable_thinking
            };
            saveSettings(updatedSettings);
        }
    } catch (err) {
        console.error('Failed to sync backend config:', err);
    }
}

function saveSettingsFromUI() {
    const select = document.getElementById('llmModel');
    const customInput = document.getElementById('llmModelCustom');
    let activeModel = '';
    if (select && customInput) {
        activeModel = select.style.display === 'none' ? customInput.value : select.value;
    }

    const settings = {
        modelVersion: document.querySelector('input[name="modelVersion"]:checked').value,
        enableFormula: document.getElementById('enableFormula').checked,
        enableTable: document.getElementById('enableTable').checked,
        forceOcr: document.getElementById('forceOcr').checked,
        language: document.getElementById('language').value,
        outputDir: document.getElementById('outputDir').textContent,
        userId: document.getElementById('userId').textContent,
        modelSource: document.getElementById('modelSource').value,
        modelCacheDir: document.getElementById('modelCacheDir').value,
        enableNotificationSound: document.getElementById('enableNotificationSound').checked,
        
        // LLM configs
        llmEnable: document.getElementById('llmEnable')?.checked || false,
        llmApiKey: document.getElementById('llmApiKey')?.value || '',
        llmBaseUrl: document.getElementById('llmBaseUrl')?.value || '',
        llmModel: activeModel || '',
        llmEnableThinking: document.getElementById('llmEnableThinking')?.checked || false
    };

    saveSettings(settings);

    // Apply model source to environment
    applyModelSource(
        settings.modelSource, 
        settings.modelCacheDir, 
        settings.llmEnable,
        settings.llmApiKey,
        settings.llmBaseUrl,
        settings.llmModel,
        settings.llmEnableThinking
    );

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

// ==================== Software Update Logic ====================
async function initAppVersion() {
    if (window.electronAPI && window.electronAPI.getAppVersion) {
        try {
            const version = await window.electronAPI.getAppVersion();
            // Update sidebar version span
            const sidebarVer = document.querySelector('.sidebar-footer .version');
            if (sidebarVer) sidebarVer.textContent = `v${version}`;
            
            // Update settings update-tab current version span
            const currentVerText = document.getElementById('currentVersionText');
            if (currentVerText) currentVerText.textContent = `v${version}`;
        } catch (err) {
            console.error('Failed to get app version:', err);
        }
    }
}

function initUpdateLogic() {
    const btnCheckUpdate = document.getElementById('btnCheckUpdate');
    const lastCheckTime = document.getElementById('lastCheckTime');
    const latestVersionBadge = document.getElementById('latestVersionBadge');
    const latestVersionText = document.getElementById('latestVersionText');
    const updateDetailsSection = document.getElementById('updateDetailsSection');
    const changelogContainer = document.getElementById('changelogContainer');
    const downloadProgressContainer = document.getElementById('downloadProgressContainer');
    const downloadStatusText = document.getElementById('downloadStatusText');
    const downloadPercentText = document.getElementById('downloadPercentText');
    const downloadProgressFill = document.getElementById('downloadProgressFill');
    const downloadSpeedText = document.getElementById('downloadSpeedText');
    const btnStartDownload = document.getElementById('btnStartDownload');
    const btnOpenReleasePage = document.getElementById('btnOpenReleasePage');
    const btnCancelDownload = document.getElementById('btnCancelDownload');
    const btnInstallUpdate = document.getElementById('btnInstallUpdate');

    let updateData = null; // Stores release data from GitHub
    let targetAssetUrl = null; // Download URL for current platform package
    let downloadedFilePath = null; // Downloaded file location
    let unsubscribeDownloadListener = null;

    // Helper: format bytes to MB
    function formatMB(bytes) {
        if (!bytes || isNaN(bytes)) return '0.0 MB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Helper: Semver comparison (current, latest) -> true if latest is newer
    function isNewerVersion(current, latest) {
        const cleanCurrent = current.replace(/^v/, '');
        const cleanLatest = latest.replace(/^v/, '');
        const partsCurrent = cleanCurrent.split('.').map(Number);
        const partsLatest = cleanLatest.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            const vCurr = partsCurrent[i] || 0;
            const vLate = partsLatest[i] || 0;
            if (vLate > vCurr) return true;
            if (vLate < vCurr) return false;
        }
        return false;
    }

    btnCheckUpdate.addEventListener('click', async () => {
        btnCheckUpdate.disabled = true;
        btnCheckUpdate.textContent = '检查中...';
        
        try {
            // Retrieve current version
            let currentVersion = '1.0.0';
            if (window.electronAPI && window.electronAPI.getAppVersion) {
                currentVersion = await window.electronAPI.getAppVersion();
            }

            // Request GitHub releases
            const response = await fetch('https://api.github.com/repos/demon820308/DocMiner/releases/latest');
            if (!response.ok) {
                throw new Error(`GitHub API returned status: ${response.status}`);
            }

            const data = await response.json();
            updateData = data;
            const latestVersion = data.tag_name;

            // Show last checked time
            const now = new Date();
            lastCheckTime.textContent = `上次检查: ${now.toLocaleTimeString()}`;
            lastCheckTime.style.display = 'inline';

            // Compare versions
            const hasUpdate = isNewerVersion(currentVersion, latestVersion);

            if (hasUpdate) {
                // Show latest badge
                latestVersionText.textContent = latestVersion;
                latestVersionBadge.style.display = 'inline-block';
                updateDetailsSection.style.display = 'block';
                
                // Render release notes
                if (window.marked && window.marked.parse) {
                    changelogContainer.innerHTML = window.marked.parse(data.body || '*没有更新日志*');
                } else {
                    changelogContainer.textContent = data.body || '没有更新日志';
                }

                // Match installer for current platform
                let isWin = navigator.userAgent.includes('Windows');
                let isMac = navigator.userAgent.includes('Mac');
                targetAssetUrl = null;

                if (data.assets && data.assets.length > 0) {
                    for (const asset of data.assets) {
                        const name = asset.name.toLowerCase();
                        if (isWin && name.endsWith('.exe')) {
                            targetAssetUrl = asset.browser_download_url;
                            break;
                        } else if (isMac && name.endsWith('.dmg')) {
                            targetAssetUrl = asset.browser_download_url;
                            break;
                        }
                    }
                }

                // Show buttons
                btnStartDownload.style.display = targetAssetUrl ? 'inline-flex' : 'none';
                btnOpenReleasePage.style.display = 'inline-flex';
                btnCancelDownload.style.display = 'none';
                btnInstallUpdate.style.display = 'none';
                downloadProgressContainer.style.display = 'none';

                showToast('发现新版本: ' + latestVersion, 'success');
            } else {
                latestVersionBadge.style.display = 'none';
                updateDetailsSection.style.display = 'none';
                showToast('已是最新版本', 'success');
            }
        } catch (error) {
            console.error('Check for updates failed:', error);
            showToast('检查更新失败，请稍后重试', 'error');
        } finally {
            btnCheckUpdate.disabled = false;
            btnCheckUpdate.textContent = '检查更新';
        }
    });

    btnOpenReleasePage.addEventListener('click', () => {
        if (updateData && updateData.html_url && window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal(updateData.html_url);
        }
    });

    btnStartDownload.addEventListener('click', () => {
        if (!targetAssetUrl) {
            showToast('未找到适配当前系统的安装包，请在浏览器中下载', 'warning');
            return;
        }

        btnCheckUpdate.disabled = true;
        btnStartDownload.style.display = 'none';
        btnOpenReleasePage.style.display = 'none';
        btnCancelDownload.style.display = 'inline-flex';
        btnInstallUpdate.style.display = 'none';
        
        downloadProgressContainer.style.display = 'block';
        downloadPercentText.textContent = '0%';
        downloadProgressFill.style.width = '0%';
        downloadStatusText.textContent = '准备下载...';
        downloadSpeedText.textContent = '0.0 MB / 0.0 MB';

        // Call main process to download
        if (window.electronAPI && window.electronAPI.startDownload) {
            window.electronAPI.startDownload(targetAssetUrl);

            // Clean previous subscription if any
            if (unsubscribeDownloadListener) unsubscribeDownloadListener();

            // Subscribe to status updates
            unsubscribeDownloadListener = window.electronAPI.onDownloadStatus((info) => {
                if (info.status === 'downloading') {
                    downloadStatusText.textContent = '正在下载...';
                    downloadPercentText.textContent = `${info.percent}%`;
                    downloadProgressFill.style.width = `${info.percent}%`;
                    downloadSpeedText.textContent = `${formatMB(info.received)} / ${formatMB(info.total)}`;
                } else if (info.status === 'completed') {
                    downloadStatusText.textContent = '下载完成！';
                    downloadPercentText.textContent = '100%';
                    downloadProgressFill.style.width = '100%';
                    downloadedFilePath = info.savePath;

                    btnCancelDownload.style.display = 'none';
                    btnInstallUpdate.style.display = 'inline-flex';
                    showToast('下载完成，请重启并安装', 'success');
                    
                    if (unsubscribeDownloadListener) {
                        unsubscribeDownloadListener();
                        unsubscribeDownloadListener = null;
                    }
                } else if (info.status === 'cancelled') {
                    resetDownloadUI('已取消下载');
                } else if (info.status === 'failed' || info.status === 'interrupted') {
                    resetDownloadUI('下载失败: ' + (info.error || '连接中断'));
                    showToast('下载失败', 'error');
                }
            });
        }
    });

    btnCancelDownload.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.cancelDownload) {
            window.electronAPI.cancelDownload();
        }
    });

    btnInstallUpdate.addEventListener('click', () => {
        if (downloadedFilePath && window.electronAPI && window.electronAPI.installUpdate) {
            showToast('正在启动安装程序...', 'info');
            setTimeout(() => {
                window.electronAPI.installUpdate(downloadedFilePath);
            }, 800);
        }
    });

    function resetDownloadUI(statusMsg) {
        btnCheckUpdate.disabled = false;
        btnStartDownload.style.display = 'inline-flex';
        btnOpenReleasePage.style.display = 'inline-flex';
        btnCancelDownload.style.display = 'none';
        btnInstallUpdate.style.display = 'none';
        downloadProgressContainer.style.display = 'none';
        
        if (statusMsg) {
            showToast(statusMsg, 'info');
        }

        if (unsubscribeDownloadListener) {
            unsubscribeDownloadListener();
            unsubscribeDownloadListener = null;
        }
    }
}

async function applyModelSource(source, cacheDir, llmEnable, llmApiKey, llmBaseUrl, llmModel, llmEnableThinking) {
    // Store in localStorage for backend to read
    localStorage.setItem('mineru.modelSource', source);
    localStorage.setItem('mineru.modelCacheDir', cacheDir || '');
    localStorage.setItem('mineru.llmEnable', llmEnable || false);
    localStorage.setItem('mineru.llmApiKey', llmApiKey || '');
    localStorage.setItem('mineru.llmBaseUrl', llmBaseUrl || '');
    localStorage.setItem('mineru.llmModel', llmModel || '');
    localStorage.setItem('mineru.llmEnableThinking', llmEnableThinking || false);

    // Update backend configuration
    try {
        const response = await fetch('/api/model_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                source, 
                cache_dir: cacheDir || '',
                llm_enable: llmEnable || false,
                llm_api_key: llmApiKey || '',
                llm_base_url: llmBaseUrl || '',
                llm_model: llmModel || '',
                llm_enable_thinking: llmEnableThinking || false
            })
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
        let settings = data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
        // Migrate ./output to ~/DocMiner/output to prevent file loss on reinstallation
        if (settings.outputDir === './output') {
            settings.outputDir = '~/DocMiner/output';
        }
        return settings;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function playDingSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(987.77, now); // B5 note
        
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1975.53, now); // B6 note (overtone)
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05); // Attack
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.2); // Decay
        
        osc1.start(now);
        osc2.start(now);
        
        osc1.stop(now + 1.2);
        osc2.stop(now + 1.2);
    } catch (err) {
        console.error('Failed to play ding sound:', err);
    }
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

    // Add event listener for MD saving
    document.getElementById('btnSaveMd')?.addEventListener('click', () => {
        const title = document.getElementById('viewerTitle')?.textContent?.trim() || 'document';
        const filename = `${title}.md`;
        if (currentMdContent) {
            if (window.electronAPI && window.electronAPI.saveAsMD) {
                window.electronAPI.saveAsMD(currentMdContent, filename);
            } else {
                // Fallback to browser Blob download
                const blob = new Blob([currentMdContent], { type: 'text/markdown;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', filename);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }
        } else {
            alert('没有可保存的 Markdown 内容');
        }
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

    // Clean up empty lines, redundant spaces, and double breaks in a temporary container
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = mdContent.innerHTML;
    
    // Remove empty paragraphs, keeping at most one consecutive empty paragraph to preserve natural line breaks
    let lastWasEmpty = false;
    tempDiv.querySelectorAll('p').forEach(p => {
        const text = p.textContent.trim().replace(/\u00a0/g, ''); // Remove non-breaking spaces
        const hasVisibleContent = text.length > 0;
        const hasMediaOrStructure = p.querySelector('img, table, iframe, svg, canvas, .katex, .katex-display');
        
        if (!hasVisibleContent && !hasMediaOrStructure) {
            if (lastWasEmpty) {
                p.remove();
            } else {
                lastWasEmpty = true;
            }
        } else {
            lastWasEmpty = false;
        }
    });

    // Remove empty headings or lists
    tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6, ul, ol').forEach(el => {
        if (!el.textContent.trim() && !el.querySelector('*')) {
            el.remove();
        }
    });

    // Remove consecutive redundant br elements
    tempDiv.querySelectorAll('br').forEach(br => {
        let next = br.nextSibling;
        while (next && next.nodeType === 3 && !next.textContent.trim()) {
            next = next.nextSibling;
        }
        if (next && (next.nodeName === 'BR' || (next.nodeType === 1 && next.tagName === 'BR'))) {
            br.remove();
        }
    });

    const cleanedHTML = tempDiv.innerHTML;

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
            <link rel="stylesheet" href="/style.css?v=2">
            <style>
                @page {
                    size: A4;
                    margin: 0 !important;
                }
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
                    font-family: 'Inter', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
                }
                .print-layout-wrapper {
                    position: relative;
                    margin-top: 50px;
                    display: flex;
                    justify-content: center;
                }
                .print-preview-container {
                    background: #fff;
                    width: 210mm; /* A4 width */
                    min-height: 297mm; /* A4 height */
                    padding: 10mm !important; /* Compact padding matching compact margins */
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.05);
                    border-radius: 4px;
                    box-sizing: border-box;
                }

                /* Ruler Layout */
                .ruler-vertical {
                    position: absolute;
                    left: -50px;
                    top: 0;
                    width: 40px;
                    height: 29.7cm;
                    border-right: 2px solid #a8a090;
                    font-family: 'Inter', sans-serif;
                    font-size: 9px;
                    color: #8c8273;
                    user-select: none;
                }
                .ruler-horizontal {
                    position: absolute;
                    left: 0;
                    top: -50px;
                    height: 40px;
                    width: 21cm;
                    border-bottom: 2px solid #a8a090;
                    font-family: 'Inter', sans-serif;
                    font-size: 9px;
                    color: #8c8273;
                    user-select: none;
                }
                .safety-line {
                    position: absolute;
                    left: -50px;
                    top: 28.5cm;
                    width: calc(210mm + 50px);
                    height: 1px;
                    border-top: 1px dashed rgba(220, 38, 38, 0.35);
                    z-index: 10;
                    pointer-events: none;
                }
                .safety-line-label {
                    position: absolute;
                    left: 60px;
                    top: 4px;
                    font-family: 'Inter', sans-serif;
                    font-size: 9px;
                    color: #dc2626;
                    font-weight: bold;
                    background: rgba(220, 38, 38, 0.08);
                    border: 1px solid rgba(220, 38, 38, 0.2);
                    padding: 1px 5px;
                    border-radius: 3px;
                }
                .ruler-tick {
                    position: absolute;
                    box-sizing: border-box;
                }
                
                /* Vertical ticks */
                .ruler-vertical .ruler-tick {
                    right: 0;
                    width: 6px;
                    height: 1px;
                    background: #a8a090;
                }
                .ruler-vertical .ruler-tick.major {
                    width: 15px;
                    background: #5c554a;
                    height: 1.5px;
                }
                .ruler-vertical .ruler-tick.major::before {
                    content: attr(data-label);
                    position: absolute;
                    right: 20px;
                    top: -6px;
                    white-space: nowrap;
                    font-weight: 500;
                }
                .ruler-vertical .ruler-tick.medium {
                    width: 10px;
                    background: #8c8273;
                }
                .ruler-vertical .ruler-tick.medium::before {
                    content: attr(data-label);
                    position: absolute;
                    right: 14px;
                    top: -6px;
                    white-space: nowrap;
                }
                .ruler-vertical .ruler-tick.minor {
                    width: 5px;
                }
                .ruler-vertical .end-tick {
                    background: #cc785c !important;
                    height: 2px !important;
                    width: 25px !important;
                }
                .ruler-vertical .end-tick::before {
                    color: #cc785c;
                    font-weight: 600;
                }

                /* Horizontal ticks */
                .ruler-horizontal .ruler-tick {
                    bottom: 0;
                    width: 1px;
                    height: 6px;
                    background: #a8a090;
                }
                .ruler-horizontal .ruler-tick.major {
                    height: 15px;
                    background: #5c554a;
                    width: 1.5px;
                }
                .ruler-horizontal .ruler-tick.major::before {
                    content: attr(data-label);
                    position: absolute;
                    left: -10px;
                    bottom: 18px;
                    white-space: nowrap;
                    font-weight: 500;
                }
                .ruler-horizontal .ruler-tick.medium {
                    height: 10px;
                    background: #8c8273;
                }
                .ruler-horizontal .ruler-tick.medium::before {
                    content: attr(data-label);
                    position: absolute;
                    left: -4px;
                    bottom: 13px;
                    white-space: nowrap;
                }
                .ruler-horizontal .ruler-tick.minor {
                    height: 5px;
                }

                :root {
                    --base-font-size: 10.5pt;
                    --heading-font-size: 14pt;
                    --table-font-size: 10.5pt;
                    --base-line-height: 1.45;
                    --block-margin: 12px;
                    --page-padding: 10mm;
                    --table-cell-padding-y: 6px;
                    --table-cell-padding-x: 10px;
                    --text-align: left;
                    --font-family: 'Inter', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
                }

                .print-btn.active {
                    background: #cc785c !important;
                    border-color: #cc785c !important;
                    color: #fff !important;
                    box-shadow: 0 0 8px rgba(204, 120, 92, 0.4);
                }

                /* Preset: Normal (标准原版) */
                .preset-normal.markdown-content {
                    font-size: 10.5pt !important;
                    line-height: 1.45 !important;
                }
                .preset-normal.markdown-content p,
                .preset-normal.markdown-content ul,
                .preset-normal.markdown-content ol,
                .preset-normal.markdown-content li,
                .preset-normal.markdown-content pre,
                .preset-normal.markdown-content blockquote {
                    margin-top: 12px !important;
                    margin-bottom: 12px !important;
                }
                .preset-normal.markdown-content h1,
                .preset-normal.markdown-content h2 {
                    font-size: 14pt !important;
                    margin-top: 24px !important;
                    margin-bottom: 12px !important;
                }
                .preset-normal.markdown-content h3,
                .preset-normal.markdown-content h4,
                .preset-normal.markdown-content h5,
                .preset-normal.markdown-content h6 {
                    font-size: 12pt !important;
                    margin-top: 16px !important;
                    margin-bottom: 8px !important;
                }
                .preset-normal.markdown-content table {
                    margin-top: 12px !important;
                    margin-bottom: 12px !important;
                }
                .preset-normal.markdown-content td,
                .preset-normal.markdown-content th {
                    padding: 6px 10px !important;
                }

                /* Preset: Compact (Auto-fit base) */
                .preset-compact.markdown-content {
                    font-size: 10pt !important;
                    line-height: 1.35 !important;
                }
                .preset-compact.markdown-content p,
                .preset-compact.markdown-content ul,
                .preset-compact.markdown-content ol,
                .preset-compact.markdown-content li,
                .preset-compact.markdown-content pre,
                .preset-compact.markdown-content blockquote {
                    margin-top: 8px !important;
                    margin-bottom: 8px !important;
                }
                .preset-compact.markdown-content h1,
                .preset-compact.markdown-content h2 {
                    font-size: 13pt !important;
                    margin-top: 18px !important;
                    margin-bottom: 10px !important;
                }
                .preset-compact.markdown-content h3,
                .preset-compact.markdown-content h4,
                .preset-compact.markdown-content h5,
                .preset-compact.markdown-content h6 {
                    font-size: 11.5pt !important;
                    margin-top: 12px !important;
                    margin-bottom: 6px !important;
                }
                .preset-compact.markdown-content table {
                    margin-top: 8px !important;
                    margin-bottom: 8px !important;
                }
                .preset-compact.markdown-content td,
                .preset-compact.markdown-content th {
                    padding: 4px 8px !important;
                }

                /* Preset: Ultra-Compact (极简单页) */
                .preset-ultra.markdown-content {
                    font-size: 9.5pt !important;
                    line-height: 1.25 !important;
                }
                .preset-ultra.markdown-content p,
                .preset-ultra.markdown-content ul,
                .preset-ultra.markdown-content ol,
                .preset-ultra.markdown-content li,
                .preset-ultra.markdown-content pre,
                .preset-ultra.markdown-content blockquote {
                    margin-top: 5px !important;
                    margin-bottom: 5px !important;
                }
                .preset-ultra.markdown-content h1,
                .preset-ultra.markdown-content h2 {
                    font-size: 12pt !important;
                    margin-top: 12px !important;
                    margin-bottom: 6px !important;
                }
                .preset-ultra.markdown-content h3,
                .preset-ultra.markdown-content h4,
                .preset-ultra.markdown-content h5,
                .preset-ultra.markdown-content h6 {
                    font-size: 10.5pt !important;
                    margin-top: 8px !important;
                    margin-bottom: 4px !important;
                }
                .preset-ultra.markdown-content table {
                    margin-top: 5px !important;
                    margin-bottom: 5px !important;
                }
                .preset-ultra.markdown-content td,
                .preset-ultra.markdown-content th {
                    padding: 3px 6px !important;
                }

                /* Preset: Table-Shrink (表格微缩) */
                .preset-table-shrink.markdown-content {
                    font-size: 10.5pt !important;
                    line-height: 1.45 !important;
                }
                .preset-table-shrink.markdown-content p,
                .preset-table-shrink.markdown-content ul,
                .preset-table-shrink.markdown-content ol,
                .preset-table-shrink.markdown-content li,
                .preset-table-shrink.markdown-content pre,
                .preset-table-shrink.markdown-content blockquote {
                    margin-top: 12px !important;
                    margin-bottom: 12px !important;
                }
                .preset-table-shrink.markdown-content h1,
                .preset-table-shrink.markdown-content h2 {
                    font-size: 14pt !important;
                    margin-top: 24px !important;
                    margin-bottom: 12px !important;
                }
                .preset-table-shrink.markdown-content h3,
                .preset-table-shrink.markdown-content h4,
                .preset-table-shrink.markdown-content h5,
                .preset-table-shrink.markdown-content h6 {
                    font-size: 12pt !important;
                    margin-top: 16px !important;
                    margin-bottom: 8px !important;
                }
                .preset-table-shrink.markdown-content table {
                    margin-top: 4px !important;
                    margin-bottom: 4px !important;
                }
                .preset-table-shrink.markdown-content td,
                .preset-table-shrink.markdown-content th {
                    padding: 2px 4px !important;
                    line-height: 1.20 !important;
                }



                /* Preset: Custom (自定义) */
                .preset-custom.markdown-content {
                    font-size: var(--base-font-size) !important;
                    line-height: var(--base-line-height) !important;
                    font-family: var(--font-family) !important;
                    text-align: var(--text-align) !important;
                }
                .preset-custom.markdown-content p,
                .preset-custom.markdown-content ul,
                .preset-custom.markdown-content ol,
                .preset-custom.markdown-content li,
                .preset-custom.markdown-content pre,
                .preset-custom.markdown-content blockquote {
                    margin-top: var(--block-margin) !important;
                    margin-bottom: var(--block-margin) !important;
                }
                .preset-custom.markdown-content h1,
                .preset-custom.markdown-content h2 {
                    font-size: var(--heading-font-size) !important;
                    margin-top: calc(var(--block-margin) * 2) !important;
                    margin-bottom: var(--block-margin) !important;
                }
                .preset-custom.markdown-content h3,
                .preset-custom.markdown-content h4 {
                    font-size: calc(var(--heading-font-size) * 0.85) !important;
                    margin-top: calc(var(--block-margin) * 1.3) !important;
                    margin-bottom: calc(var(--block-margin) * 0.7) !important;
                }
                .preset-custom.markdown-content h5,
                .preset-custom.markdown-content h6 {
                    font-size: calc(var(--heading-font-size) * 0.75) !important;
                    margin-top: calc(var(--block-margin) * 1.1) !important;
                    margin-bottom: calc(var(--block-margin) * 0.5) !important;
                }
                .preset-custom.markdown-content table {
                    margin-top: var(--block-margin) !important;
                    margin-bottom: var(--block-margin) !important;
                }
                .preset-custom.markdown-content td,
                .preset-custom.markdown-content th {
                    padding: var(--table-cell-padding-y) var(--table-cell-padding-x) !important;
                    font-size: var(--table-font-size) !important;
                }
                .print-preview-container.custom-padding {
                    padding: var(--page-padding) !important;
                }

                /* Custom Parameter Panel */
                .custom-panel {
                    position: fixed;
                    top: 70px;
                    right: 25px;
                    background: rgba(30, 28, 25, 0.95);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 8px;
                    padding: 16px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.35);
                    z-index: 1000;
                    display: none;
                    flex-direction: column;
                    gap: 12px;
                    width: 290px;
                    color: #fff;
                    font-family: 'Inter', sans-serif;
                    backdrop-filter: blur(10px);
                }
                .custom-panel-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 0.85rem;
                }
                .custom-panel-row label {
                    width: 100px;
                    color: rgba(255, 255, 255, 0.7);
                    text-align: left;
                }
                .custom-panel-row input[type="range"] {
                    flex: 1;
                    margin: 0 10px;
                    accent-color: #cc785c;
                    cursor: pointer;
                }
                .custom-panel-row span {
                    min-width: 45px;
                    text-align: right;
                    font-weight: 500;
                    font-size: 0.8rem;
                    color: #cc785c;
                }

                .markdown-content img {
                    margin: 4px 0 !important;
                }
                .katex-display {
                    margin: 0.5em 0 !important;
                }
                
                /* Print layouts */
                @media print {
                    .print-toolbar, .ruler-vertical, .ruler-horizontal, .custom-panel, .safety-line {
                        display: none !important;
                    }
                    .print-layout-wrapper {
                        margin-top: 0 !important;
                    }
                    body {
                        display: block !important;
                        background: #fff !important;
                        padding-top: 0 !important;
                        padding-bottom: 0 !important;
                    }
                    .print-preview-container {
                        width: 210mm !important;
                        box-shadow: none !important;
                        margin: 0 !important;
                        border-radius: 0 !important;
                    }
                }
            </style>
        </head>
        <body>
            <div class="print-toolbar">
                <div class="print-toolbar-title">📄 打印预览：${document.getElementById('viewerTitle')?.textContent || '未命名文档'}</div>
                <div style="display: flex; gap: 6px; margin: 0 15px;">
                    <button class="print-btn print-btn-secondary active" id="btnPresetNormal" onclick="applyPreset('normal')" style="padding: 6px 12px; font-size: 0.85rem;">标准原版</button>
                    <button class="print-btn print-btn-secondary" id="btnPresetAuto" onclick="applyPreset('auto')" style="padding: 6px 12px; font-size: 0.85rem;">自适应一页</button>
                    <button class="print-btn print-btn-secondary" id="btnPresetUltra" onclick="applyPreset('ultra')" style="padding: 6px 12px; font-size: 0.85rem;">极简单页</button>
                    <button class="print-btn print-btn-secondary" id="btnPresetTable" onclick="applyPreset('table')" style="padding: 6px 12px; font-size: 0.85rem;">表格微缩</button>
                    <button class="print-btn print-btn-secondary" id="btnPresetCustom" onclick="applyPreset('custom')" style="padding: 6px 12px; font-size: 0.85rem;">自定义...</button>
                </div>
                <div class="print-toolbar-center">
                    <button class="print-btn print-btn-secondary" onclick="changeZoom(-0.1)" title="缩小">−</button>
                    <span class="zoom-val" id="zoomVal">100%</span>
                    <button class="print-btn print-btn-secondary" onclick="changeZoom(0.1)" title="放大">+</button>
                </div>
                <div class="print-toolbar-actions">
                    <button class="print-btn print-btn-primary" onclick="window.print()">
                        <span>🖨️</span>
                        <span>打印</span>
                    </button>
                    <button class="print-btn print-btn-primary" onclick="window.opener && window.opener.triggerSavePDF ? window.opener.triggerSavePDF() : (window.electronAPI ? window.electronAPI.saveAsPDF() : window.print())">
                        <span>💾</span>
                        <span>另存为 PDF</span>
                    </button>
                    <button class="print-btn print-btn-secondary" onclick="window.close()">
                        <span>关闭预览</span>
                    </button>
                </div>
            </div>
            
            <div class="custom-panel" id="customPanel">
                <div class="custom-panel-row">
                    <label>字号大小:</label>
                    <input type="range" id="paramFontSize" min="8" max="14" step="0.5" value="10.5" oninput="updateCustomParam()">
                    <span id="valFontSize">10.5pt</span>
                </div>
                <div class="custom-panel-row">
                    <label>标题字号:</label>
                    <input type="range" id="paramHeadingSize" min="10" max="22" step="0.5" value="14" oninput="updateCustomParam()">
                    <span id="valHeadingSize">14pt</span>
                </div>
                <div class="custom-panel-row">
                    <label>表格字号:</label>
                    <input type="range" id="paramTableFontSize" min="7" max="13" step="0.5" value="10.5" oninput="updateCustomParam()">
                    <span id="valTableFontSize">10.5pt</span>
                </div>
                <div class="custom-panel-row">
                    <label>段落行高:</label>
                    <input type="range" id="paramLineHeight" min="1.1" max="1.8" step="0.05" value="1.45" oninput="updateCustomParam()">
                    <span id="valLineHeight">1.45</span>
                </div>
                <div class="custom-panel-row">
                    <label>段落边距:</label>
                    <input type="range" id="paramBlockMargin" min="0" max="24" step="1" value="12" oninput="updateCustomParam()">
                    <span id="valBlockMargin">12px</span>
                </div>
                <div class="custom-panel-row">
                    <label>单元内衬:</label>
                    <input type="range" id="paramTableCellPadding" min="1" max="15" step="1" value="6" oninput="updateCustomParam()">
                    <span id="valTableCellPadding">6px</span>
                </div>
                <div class="custom-panel-row">
                    <label>字体风格:</label>
                    <select id="paramFontFamily" onchange="updateCustomParam()" style="flex: 1; margin: 0 10px; background: #3c352a; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px; font-size: 0.8rem; cursor: pointer; outline: none;">
                        <option value="default" selected>系统默认</option>
                        <option value="serif">典雅宋体</option>
                        <option value="mono">极客等宽</option>
                    </select>
                </div>
                <div class="custom-panel-row" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; justify-content: flex-start; gap: 12px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="paramAutoFit" onchange="toggleAutoFit(true)" style="cursor: pointer;">
                        <label for="paramAutoFit" style="cursor: pointer; user-select: none; width: auto; color: rgba(255,255,255,0.9); margin-bottom: 0;">自适应单页</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="paramKeepScale" checked onchange="toggleAutoFit(false)" style="cursor: pointer;">
                        <label for="paramKeepScale" style="cursor: pointer; user-select: none; width: auto; color: rgba(255,255,255,0.9); margin-bottom: 0;">比例不变</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="paramJustify" onchange="updateCustomParam()" style="cursor: pointer;">
                        <label for="paramJustify" style="cursor: pointer; user-select: none; width: auto; color: rgba(255,255,255,0.9); margin-bottom: 0;">两端对齐</label>
                    </div>
                </div>
            </div>

            <div class="print-layout-wrapper" id="layoutWrapper">
                <div class="ruler-vertical" id="verticalRuler"></div>
                <div class="ruler-horizontal" id="horizontalRuler"></div>
                <div class="safety-line" id="safetyLine">
                    <span class="safety-line-label">安全线 (28.5cm)</span>
                </div>
                <div class="print-preview-container" id="previewContainer">
                    <div class="markdown-content" id="markdownContentArea">
                        ${cleanedHTML}
                    </div>
                </div>
            </div>
            
            <script>
                let zoom = 1.0;
                window.changeZoom = function(delta) {
                    zoom = Math.max(0.5, Math.min(2.0, zoom + delta));
                    document.getElementById('layoutWrapper').style.zoom = zoom;
                    document.getElementById('zoomVal').textContent = Math.round(zoom * 100) + '%';
                };

                // Reusable high-precision autoscale calculation
                window.recalculateAutoscale = function() {
                    if (currentPreset === 'normal' || (currentPreset === 'custom' && !document.getElementById('paramAutoFit').checked)) {
                        return;
                    }
                    const container = document.getElementById('markdownContentArea');
                    if (!container) return;
                    
                    // Create temp div to measure 297mm (A4 height) in px
                    const temp = document.createElement('div');
                    temp.style.height = '297mm';
                    temp.style.position = 'absolute';
                    temp.style.visibility = 'hidden';
                    document.body.appendChild(temp);
                    const a4HeightPx = temp.clientHeight;
                    document.body.removeChild(temp);
                    
                    const printableHeightPx = a4HeightPx * (275 / 297); // 28.5cm limit (28.5cm - 1cm top margin)
                    const contentHeightPx = container.scrollHeight;
                    
                    if (contentHeightPx > printableHeightPx) {
                        // Apply a 0.965 safety margin factor (3.5% buffer) to guarantee content never exceeds 28.5cm due to browser rounding
                        let autoScale = (printableHeightPx / contentHeightPx) * 0.965;
                        autoScale = Math.max(0.4, autoScale); // Allow scaling down to 40% to handle extreme dense content
                        container.style.zoom = autoScale.toFixed(4);
                        document.getElementById('zoomVal').textContent = Math.round(autoScale * 100) + '% (自适应)';
                    } else {
                        container.style.zoom = 1.0;
                        document.getElementById('zoomVal').textContent = '100%';
                    }
                };

                // Preset Switcher Logic
                let currentPreset = 'normal';
                window.applyPreset = function(type) {
                    const container = document.getElementById('markdownContentArea');
                    const wrapper = document.getElementById('layoutWrapper');
                    const page = document.getElementById('previewContainer');
                    
                    // Reset active states
                    document.getElementById('btnPresetNormal').classList.remove('active');
                    document.getElementById('btnPresetAuto').classList.remove('active');
                    document.getElementById('btnPresetUltra').classList.remove('active');
                    document.getElementById('btnPresetTable').classList.remove('active');
                    document.getElementById('btnPresetCustom').classList.remove('active');
                    
                    // Apply active button
                    if (type === 'normal') document.getElementById('btnPresetNormal').classList.add('active');
                    if (type === 'auto') document.getElementById('btnPresetAuto').classList.add('active');
                    if (type === 'ultra') document.getElementById('btnPresetUltra').classList.add('active');
                    if (type === 'table') document.getElementById('btnPresetTable').classList.add('active');
                    if (type === 'custom') document.getElementById('btnPresetCustom').classList.add('active');
                    
                    currentPreset = type;
                    
                    // Remove current classes
                    container.classList.remove('preset-normal', 'preset-compact', 'preset-ultra', 'preset-table-shrink', 'preset-custom');
                    page.classList.remove('custom-padding');
                    
                    // Reset content area zoom first
                    container.style.zoom = 1.0;
                    document.getElementById('zoomVal').textContent = '100%';
                    
                    if (type === 'normal') {
                        container.classList.add('preset-normal');
                        document.getElementById('customPanel').style.display = 'none';
                    } else if (type === 'auto') {
                        container.classList.add('preset-normal');
                        document.getElementById('customPanel').style.display = 'none';
                    } else if (type === 'ultra') {
                        container.classList.add('preset-ultra');
                        document.getElementById('customPanel').style.display = 'none';
                    } else if (type === 'table') {
                        container.classList.add('preset-table-shrink');
                        document.getElementById('customPanel').style.display = 'none';
                    } else if (type === 'custom') {
                        container.classList.add('preset-custom');
                        page.classList.add('custom-padding');
                        document.getElementById('customPanel').style.display = 'flex';
                        updateCustomParam();
                        return; // Done
                    }
                    
                    // Run autoscale calculation with multiple checks to handle rendering delays (KaTeX, image loading, table rendering)
                    setTimeout(recalculateAutoscale, 50);
                    setTimeout(recalculateAutoscale, 200);
                    setTimeout(recalculateAutoscale, 500);
                };

                // Real-time custom parameter update
                window.updateCustomParam = function() {
                    const container = document.getElementById('markdownContentArea');
                    const wrapper = document.getElementById('layoutWrapper');
                    const page = document.getElementById('previewContainer');
                    
                    const fontSize = document.getElementById('paramFontSize').value;
                    const headingSize = document.getElementById('paramHeadingSize').value;
                    const tableFontSize = document.getElementById('paramTableFontSize').value;
                    const lineHeight = document.getElementById('paramLineHeight').value;
                    const blockMargin = document.getElementById('paramBlockMargin').value + 'px';
                    const cellPadding = document.getElementById('paramTableCellPadding').value + 'px';
                    const fontFamilyKey = document.getElementById('paramFontFamily').value;
                    const justify = document.getElementById('paramJustify').checked;
                    const autoFit = document.getElementById('paramAutoFit').checked;
                    
                    // Update label values
                    document.getElementById('valFontSize').textContent = fontSize + 'pt';
                    document.getElementById('valHeadingSize').textContent = headingSize + 'pt';
                    document.getElementById('valTableFontSize').textContent = tableFontSize + 'pt';
                    document.getElementById('valLineHeight').textContent = lineHeight;
                    document.getElementById('valBlockMargin').textContent = blockMargin;
                    document.getElementById('valTableCellPadding').textContent = cellPadding;
                    
                    // Font families map
                    let fontValue = "'Inter', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif";
                    if (fontFamilyKey === 'serif') {
                        fontValue = "'Cormorant Garamond', 'SimSun', 'Songti SC', serif";
                    } else if (fontFamilyKey === 'mono') {
                        fontValue = "'JetBrains Mono', 'Courier New', monospace";
                    }
                    
                    // Set CSS variables on root
                    document.documentElement.style.setProperty('--base-font-size', fontSize + 'pt');
                    document.documentElement.style.setProperty('--heading-font-size', headingSize + 'pt');
                    document.documentElement.style.setProperty('--table-font-size', tableFontSize + 'pt');
                    document.documentElement.style.setProperty('--base-line-height', lineHeight);
                    document.documentElement.style.setProperty('--block-margin', blockMargin);
                    document.documentElement.style.setProperty('--page-padding', '10mm');
                    document.documentElement.style.setProperty('--table-cell-padding-y', cellPadding);
                    document.documentElement.style.setProperty('--table-cell-padding-x', (parseInt(cellPadding) * 1.5) + 'px');
                    document.documentElement.style.setProperty('--font-family', fontValue);
                    document.documentElement.style.setProperty('--text-align', justify ? 'justify' : 'left');
                    
                    // Setup dynamic page print margin (ALWAYS 0 to avoid print engine downscaling)
                    let pageStyle = document.getElementById('dynamicPageStyle');
                    if (!pageStyle) {
                        pageStyle = document.createElement('style');
                        pageStyle.id = 'dynamicPageStyle';
                        document.head.appendChild(pageStyle);
                    }
                    pageStyle.textContent = '@page { size: A4; margin: 0 !important; }';
                    
                    // Reset zoom first
                    container.style.zoom = 1.0;
                    document.getElementById('zoomVal').textContent = '100%';
                    
                    if (autoFit) {
                        // Run autoscale calculation with multiple checks to handle rendering delays
                        setTimeout(recalculateAutoscale, 50);
                        setTimeout(recalculateAutoscale, 200);
                        setTimeout(recalculateAutoscale, 500);
                    }
                };

                // Link mutually exclusive checkboxes
                window.toggleAutoFit = function(isAutoFit) {
                    const autoFitCheckbox = document.getElementById('paramAutoFit');
                    const keepScaleCheckbox = document.getElementById('paramKeepScale');
                    if (isAutoFit) {
                        keepScaleCheckbox.checked = !autoFitCheckbox.checked;
                    } else {
                        autoFitCheckbox.checked = !keepScaleCheckbox.checked;
                    }
                    updateCustomParam();
                };

                // Initialize default preset on load (default to standard normal layout)
                window.addEventListener('load', () => {
                    applyPreset('normal');
                });

                // Generate vertical ruler ticks (A4 height is 29.7cm)
                const ruler = document.getElementById('verticalRuler');
                for (let i = 0; i <= 29.7; i += 0.5) {
                    if (Math.abs(i - 29.7) < 0.1) continue;
                    const tick = document.createElement('div');
                    tick.className = 'ruler-tick';
                    tick.style.top = i + 'cm';
                    
                    if (i % 5 === 0) {
                        tick.className += ' major';
                        tick.setAttribute('data-label', i + 'cm');
                    } else if (Math.round(i) === i) {
                        tick.className += ' medium';
                        tick.setAttribute('data-label', i + '');
                    } else {
                        tick.className += ' minor';
                    }
                    ruler.appendChild(tick);
                }
                const endTick = document.createElement('div');
                endTick.className = 'ruler-tick major end-tick';
                endTick.style.top = '29.7cm';
                endTick.setAttribute('data-label', '29.7cm (A4)');
                ruler.appendChild(endTick);

                // Generate horizontal ruler ticks (A4 width is 21cm)
                const hruler = document.getElementById('horizontalRuler');
                for (let i = 0; i <= 21; i += 0.5) {
                    const tick = document.createElement('div');
                    tick.className = 'ruler-tick';
                    tick.style.left = i + 'cm';
                    
                    if (i % 5 === 0) {
                        tick.className += ' major';
                        tick.setAttribute('data-label', i + 'cm');
                    } else if (Math.round(i) === i) {
                        tick.className += ' medium';
                        tick.setAttribute('data-label', i + '');
                    } else {
                        tick.className += ' minor';
                    }
                    hruler.appendChild(tick);
                }
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
window.triggerSavePDF = function() {
    if (window.electronAPI && window.electronAPI.saveAsPDF) {
        window.electronAPI.saveAsPDF();
    } else {
        console.error("electronAPI.saveAsPDF is not available in parent window.");
    }
};

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
