// Combined JS from root: utils.js, charts.js, auth.js, app.js
// This keeps the same behavior and design.

/* ===== utils.js ===== */
// Utility + API layer (No localStorage)
let BACKEND_URL = "https://acc-backend-n4be.onrender.com/"; // Will be updated by detectBackendUrl()
let AUTH_TOKEN = null;
let CURRENT_USERNAME = null;
let dealersState = {}; // single source of truth in memory

async function detectBackendUrl() {
    // Default to port 10000 (standard backend port)
    const defaultUrl = "http://localhost:10000";
    BACKEND_URL = defaultUrl;
    
    // If window.BACKEND_URL is explicitly set, use it
    if (typeof window !== 'undefined' && window.BACKEND_URL) {
        BACKEND_URL = window.BACKEND_URL;
        return BACKEND_URL;
    }
    
    const unique = new Set();
    const candidates = [
        "http://localhost:10000",
        "http://127.0.0.1:10000",
        "http://localhost:10001",
        "http://127.0.0.1:10001"
    ].filter(url => {
        if (unique.has(url)) return false;
        unique.add(url);
        return true;
    });
    
    for (const base of candidates) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${base}/`, { 
                signal: controller.signal,
                method: 'GET',
                mode: 'cors'
            });
            clearTimeout(timeout);
            if (res.ok || res.status === 200) {
                BACKEND_URL = base;
                console.log('Backend detected at:', BACKEND_URL);
                return BACKEND_URL;
            }
        } catch (e) {
            // Continue to next candidate
            continue;
        }
    }
    
    // If detection fails, default to 10000
    BACKEND_URL = defaultUrl;
    console.warn('Backend detection failed, using default:', BACKEND_URL);
    return BACKEND_URL;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDealers() {
    return dealersState || {};
}

function saveDealers(dealers) {
    dealersState = dealers || {};
    if (AUTH_TOKEN) {
        // Persist to backend
        fetch(`${BACKEND_URL}/api/data`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
            },
            body: JSON.stringify({ dealers: dealersState })
        }).catch(() => {});
    }
}

function getCurrentUser() {
    return CURRENT_USERNAME;
}

function setCurrentUser(username) {
    CURRENT_USERNAME = username || null;
}

function migrateOldData() {
    // No-op: no local migration in backend mode
}

function calculateFloorCompletion(floor) {
    if (!floor.tasks || floor.tasks.length === 0) return 0;
    const completed = floor.tasks.filter(t => t.completed).length;
    return Math.round((completed / floor.tasks.length) * 100);
}

function isFloorCompleted(floor) {
    if (!floor.tasks || floor.tasks.length === 0) return false;
    return floor.tasks.every(t => t.completed);
}

function calculateProjectStats() {
    const dealers = getDealers();
    let totalDealers = 0;
    let totalEngineers = 0;
    let totalProjects = 0;
    let pendingProjects = 0;
    let visitedCount = 0;
    let notVisitedCount = 0;
    let completedProjects = 0;
    let inProgressProjects = 0;

    Object.keys(dealers).forEach(dealerName => {
        totalDealers++;
        const dealer = dealers[dealerName];
        
        // Count engineers
        if (dealer.Engineer) {
            totalEngineers += dealer.Engineer.length;
            
            dealer.Engineer.forEach(engineer => {
                // Check visited status
                if (engineer.visitHistory && engineer.visitHistory.length > 0) {
                    visitedCount++;
                } else {
                    notVisitedCount++;
                }
                
                // Count projects
                if (engineer.projects) {
                    engineer.projects.forEach(project => {
                        totalProjects++;
                        
                        // Check if project is completed
                        let allFloorsCompleted = true;
                        if (project.floors && project.floors.length > 0) {
                            project.floors.forEach(floor => {
                                if (!isFloorCompleted(floor)) {
                                    allFloorsCompleted = false;
                                }
                            });
                        } else {
                            allFloorsCompleted = false;
                        }
                        
                        if (allFloorsCompleted && project.floors && project.floors.length > 0) {
                            completedProjects++;
                        } else {
                            pendingProjects++;
                            inProgressProjects++;
                        }
                    });
                }
            });
        }
        
        // Count other categories for visited status
        ['Sub Dealer', 'Contractor'].forEach(category => {
            if (dealer[category]) {
                dealer[category].forEach(entry => {
                    if (entry.visitHistory && entry.visitHistory.length > 0) {
                        visitedCount++;
                    } else {
                        notVisitedCount++;
                    }
                });
            }
        });
    });

    return {
        totalDealers,
        totalEngineers,
        totalProjects,
        pendingProjects,
        visitedCount,
        notVisitedCount,
        completedProjects,
        inProgressProjects
    };
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function toggleCard(cardId) {
    const cardBody = document.getElementById(cardId);
    const chevron = document.getElementById(`chevron-${cardId}`);
    
    if (cardBody && chevron) {
        cardBody.classList.toggle('active');
        chevron.classList.toggle('open');
    }
}

// Backup/Restore (manual sync across devices)
function exportMyData() {
    const username = getCurrentUser();
    if (!username) {
        alert('Please login first.');
        return;
    }
    const data = getDealers();
    const payload = {
        username,
        exportedAt: new Date().toISOString(),
        dealers: data
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work_tracker_${username}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importMyData(event) {
    const username = getCurrentUser();
    if (!username || !AUTH_TOKEN) {
        alert('Please login first.');
        event.target.value = '';
        return;
    }
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function() {
        try {
            const payload = JSON.parse(reader.result);
            if (!payload || typeof payload !== 'object' || !payload.dealers) {
                alert('Invalid backup file.');
                return;
            }
            // Send to backend restore
            fetch(`${BACKEND_URL}/api/backup/restore`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                },
                body: JSON.stringify({ dealers: payload.dealers })
            }).then(r => r.json()).then(resp => {
                dealersState = resp.dealers || {};
                if (typeof renderDealers === 'function') renderDealers();
                if (typeof updateDashboard === 'function') updateDashboard();
                alert('Data restored successfully.');
            }).catch(() => alert('Failed to restore to backend.'));
        } catch {
            alert('Failed to read backup file.');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

function getPendingProjectsData() {
    const dealers = getDealers();
    const projectData = [];
    
    Object.keys(dealers).forEach(dealerName => {
        const dealer = dealers[dealerName];
        if (dealer.Engineer) {
            dealer.Engineer.forEach(engineer => {
                if (engineer.projects) {
                    engineer.projects.forEach(project => {
                        let totalTasks = 0;
                        let completedTasks = 0;
                        
                        if (project.floors) {
                            project.floors.forEach(floor => {
                                if (floor.tasks) {
                                    totalTasks += floor.tasks.length;
                                    completedTasks += floor.tasks.filter(t => t.completed).length;
                                }
                            });
                        }
                        
                        const pendingTasks = totalTasks - completedTasks;
                        
                        if (totalTasks > 0) {
                            projectData.push({
                                name: project.name,
                                dealer: dealerName,
                                engineer: engineer.name,
                                totalTasks: totalTasks,
                                completedTasks: completedTasks,
                                pendingTasks: pendingTasks,
                                progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
                            });
                        }
                    });
                }
            });
        }
    });
    
    // Sort by pending tasks (most pending first)
    projectData.sort((a, b) => {
        if (b.pendingTasks !== a.pendingTasks) {
            return b.pendingTasks - a.pendingTasks;
        }
        return b.totalTasks - a.totalTasks;
    });
    
    return projectData;
}

/* ===== charts.js ===== */
// Chart Functions

function updateDashboard() {
    const stats = calculateProjectStats();
    
    // Update stat cards
    const totalDealersEl = document.getElementById('total-dealers');
    const totalEngineersEl = document.getElementById('total-engineers');
    const totalProjectsEl = document.getElementById('total-projects');
    const pendingProjectsEl = document.getElementById('pending-projects');
    
    if (totalDealersEl) totalDealersEl.textContent = stats.totalDealers;
    if (totalEngineersEl) totalEngineersEl.textContent = stats.totalEngineers;
    if (totalProjectsEl) totalProjectsEl.textContent = stats.totalProjects;
    if (pendingProjectsEl) pendingProjectsEl.textContent = stats.pendingProjects;
    
    // Update charts with a small delay to ensure DOM is ready
    setTimeout(() => {
        drawCompletionChart(stats);
        drawPendingChart(stats);
        drawVisitedChart(stats);
    }, 100);
}

function drawCompletionChart(stats) {
    const canvas = document.getElementById('completion-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Get container width - use chart-container or parent
    const container = canvas.parentElement;
    let containerWidth = container ? container.offsetWidth : 400;
    if (!containerWidth || containerWidth === 0) {
        containerWidth = 400; // Fallback width
    }
    // Account for padding
    containerWidth = containerWidth - 20;
    const containerHeight = 300;
    
    // Set canvas dimensions
    // Scale for high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const actualWidth = containerWidth;
    const actualHeight = containerHeight;
    
    canvas.width = actualWidth * dpr;
    canvas.height = actualHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = actualWidth + 'px';
    canvas.style.height = actualHeight + 'px';
    
    const completed = stats.completedProjects;
    const inProgress = stats.inProgressProjects;
    const total = stats.totalProjects;
    
    // Clear canvas
    ctx.clearRect(0, 0, actualWidth, actualHeight);
    
    if (total === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', actualWidth / 2, actualHeight / 2);
        return;
    }
    
    const centerX = actualWidth / 2;
    const centerY = actualHeight / 2;
    const radius = Math.min(actualWidth, actualHeight) / 2 - 50;
    
    // Draw pie chart
    let currentAngle = -Math.PI / 2;
    
    // Completed slice
    if (completed > 0) {
        const sliceAngle = (completed / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = '#27ae60';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        currentAngle += sliceAngle;
    }
    
    // In Progress slice
    if (inProgress > 0) {
        const sliceAngle = (inProgress / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = '#f39c12';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Legend
    const legendY = centerY + radius + 30;
    const legendX = centerX - 60;
    
    // Completed legend
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(legendX, legendY - 20, 15, 15);
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.fillText(`Completed: ${completed}`, legendX + 20, legendY - 8);
    
    // In Progress legend
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(legendX, legendY, 15, 15);
    ctx.fillStyle = '#333';
    ctx.fillText(`In Progress: ${inProgress}`, legendX + 20, legendY + 12);
}

function drawPendingChart(stats) {
    const canvas = document.getElementById('pending-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Get container width - use chart-container or parent
    const container = canvas.parentElement;
    let containerWidth = container ? container.offsetWidth : 400;
    if (!containerWidth || containerWidth === 0) {
        containerWidth = 400; // Fallback width
    }
    // Account for padding
    containerWidth = containerWidth - 20;
    const containerHeight = 300;
    
    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    const actualWidth = containerWidth;
    const actualHeight = containerHeight;
    
    canvas.width = actualWidth * dpr;
    canvas.height = actualHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = actualWidth + 'px';
    canvas.style.height = actualHeight + 'px';
    
    // Clear canvas
    ctx.clearRect(0, 0, actualWidth, actualHeight);
    
    // Get project details
    const projectData = getPendingProjectsData();
    
    if (projectData.length === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No projects available', actualWidth / 2, actualHeight / 2);
        return;
    }
    
    // Draw bar chart for each project
    const barHeight = 25;
    const spacing = 8;
    const startX = 20;
    const maxBars = Math.min(projectData.length, 8); // Show max 8 bars
    const availableHeight = actualHeight - 60;
    const totalBarHeight = (barHeight + spacing) * maxBars;
    let startY = (actualHeight - totalBarHeight) / 2;
    
    projectData.slice(0, maxBars).forEach((project, index) => {
        const y = startY + index * (barHeight + spacing);
        const barWidth = actualWidth - 40;
        const pendingWidth = (project.pendingTasks / project.totalTasks) * barWidth;
        
        // Background bar
        ctx.fillStyle = '#ecf0f1';
        ctx.fillRect(startX, y, barWidth, barHeight);
        
        // Pending bar
        if (pendingWidth > 0) {
            ctx.fillStyle = project.pendingTasks === project.totalTasks ? '#e74c3c' : '#f39c12';
            ctx.fillRect(startX, y, pendingWidth, barHeight);
        }
        
        // Project name (truncate if too long)
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        let projectName = project.name;
        const maxNameLength = Math.floor(actualWidth / 10);
        if (projectName.length > maxNameLength) {
            projectName = projectName.substring(0, maxNameLength - 3) + '...';
        }
        ctx.fillText(projectName, startX + 5, y + 17);
        
        // Percentage
        const percentage = project.totalTasks > 0 ? Math.round((project.pendingTasks / project.totalTasks) * 100) : 0;
        ctx.fillStyle = '#666';
        ctx.font = '11px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`${project.pendingTasks}/${project.totalTasks} (${percentage}%)`, actualWidth - 20, y + 17);
    });
    
    // Summary at bottom
    const totalPending = projectData.reduce((sum, p) => sum + p.pendingTasks, 0);
    const totalTasks = projectData.reduce((sum, p) => sum + p.totalTasks, 0);
    ctx.fillStyle = '#666';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Total Pending: ${totalPending} / ${totalTasks} tasks`, actualWidth / 2, actualHeight - 10);
}

function drawVisitedChart(stats) {
    const canvas = document.getElementById('visited-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Get container width - use chart-container or parent
    const container = canvas.parentElement;
    let containerWidth = container ? container.offsetWidth : 400;
    if (!containerWidth || containerWidth === 0) {
        containerWidth = 400; // Fallback width
    }
    // Account for padding
    containerWidth = containerWidth - 20;
    const containerHeight = 300;
    
    // Set canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    const actualWidth = containerWidth;
    const actualHeight = containerHeight;
    
    canvas.width = actualWidth * dpr;
    canvas.height = actualHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = actualWidth + 'px';
    canvas.style.height = actualHeight + 'px';
    
    const visited = stats.visitedCount;
    const notVisited = stats.notVisitedCount;
    const total = visited + notVisited;
    
    // Clear canvas
    ctx.clearRect(0, 0, actualWidth, actualHeight);
    
    if (total === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', actualWidth / 2, actualHeight / 2);
        return;
    }
    
    const barHeight = 30;
    const spacing = 20;
    const startX = 20;
    let currentY = 50;
    
    // Visited bar
    const visitedWidth = (visited / total) * (actualWidth - 40);
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(startX, currentY, visitedWidth, barHeight);
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Visited: ${visited}`, startX + visitedWidth + 10, currentY + 20);
    
    currentY += barHeight + spacing;
    
    // Not Visited bar
    const notVisitedWidth = (notVisited / total) * (actualWidth - 40);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(startX, currentY, notVisitedWidth, barHeight);
    ctx.fillStyle = '#333';
    ctx.fillText(`Not Visited: ${notVisited}`, startX + notVisitedWidth + 10, currentY + 20);
    
    // Total
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Total Entries: ${total}`, actualWidth / 2, currentY + barHeight + 30);
}

function showDashboard() {
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('main-app-section').classList.add('hidden');
    // Wait a bit for the DOM to update before drawing charts
    setTimeout(() => {
        updateDashboard();
    }, 50);
}

function showMainApp() {
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('main-app-section').classList.remove('hidden');
}

// Handle window resize for charts
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
        const dashboardSection = document.getElementById('dashboard-section');
        if (dashboardSection && !dashboardSection.classList.contains('hidden')) {
            if (typeof updateDashboard === 'function') {
                updateDashboard();
            }
        }
    }, 250);
});

// Export function to update charts from other modules
if (typeof window !== 'undefined') {
    window.updateCharts = function() {
        const dashboardSection = document.getElementById('dashboard-section');
        if (dashboardSection && !dashboardSection.classList.contains('hidden')) {
            updateDashboard();
        }
    };
}

/* ===== auth.js ===== */
// Authentication Functions

function initAuth() {
    // Clear all authentication data - force login on every page load
    AUTH_TOKEN = null;
    setCurrentUser(null);
    dealersState = {};
    
    // Clear any cached data
    if (typeof window !== 'undefined') {
        if (typeof currentProject !== 'undefined') currentProject = null;
        if (typeof currentEngineer !== 'undefined') currentEngineer = null;
        if (typeof currentDealer !== 'undefined') currentDealer = null;
    }
    
    // Always show auth screen - no bypass
    showAuth();
}

function showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
    showLogin();
}

function showApp() {
    // Validate token before showing app
    if (!AUTH_TOKEN) {
        alert('Authentication required. Please login.');
        showAuth();
        return;
    }
    
    // Verify token is valid by trying to fetch user data
    fetch(`${BACKEND_URL}/api/data`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    })
    .then(r => {
        if (r.status === 401) {
            // Token is invalid, force re-login
            AUTH_TOKEN = null;
            setCurrentUser(null);
            alert('Session expired. Please login again.');
            showAuth();
            return null;
        }
        return r.json();
    })
    .then(resp => {
        if (resp === null) return; // Already handled error
        
        // Token is valid, show app
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        showMainApp();
        
        dealersState = resp.dealers || {};
        if (typeof renderDealers === 'function') renderDealers();
        if (typeof updateDashboard === 'function') updateDashboard();
    })
    .catch((e) => {
        // Network error or invalid response
        console.error('Failed to validate token:', e);
        AUTH_TOKEN = null;
        setCurrentUser(null);
        alert('Failed to verify authentication. Please login again.');
        showAuth();
    });
}

function showLogin() {
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
}

function showRegister() {
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    document.getElementById('register-username').value = '';
    document.getElementById('register-password').value = '';
    document.getElementById('register-confirm').value = '';
}

function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
        alert('Please enter both username and password');
        return;
    }
    
    fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        return { status: r.status, data };
    })
    .then(({ status, data }) => {
        if (status === 200 && data.token) {
            AUTH_TOKEN = data.token;
            setCurrentUser(username);
            showApp();
        } else {
            alert(data.error || 'Invalid username or password. Please register first if you don\'t have an account.');
        }
    })
    .catch((e) => {
        const msg = (e && e.name === 'AbortError') ? 'Network timeout reaching backend' : (e && e.message) ? e.message : 'Login failed';
        alert(msg + '. Please ensure the server is running at ' + BACKEND_URL);
    });
}

function handleRegister() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const confirm = document.getElementById('register-confirm').value.trim();
    
    if (!username || !password || !confirm) {
        alert('Please fill in all fields');
        return;
    }
    
    if (password !== confirm) {
        alert('Passwords do not match');
        return;
    }
    
    if (password.length < 4) {
        alert('Password must be at least 4 characters');
        return;
    }
    
    if (username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }
    
    fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        return { status: r.status, data };
    })
    .then(({ status, data }) => {
        if (status === 200 && data.token) {
            AUTH_TOKEN = data.token;
            setCurrentUser(username);
            alert('Registration successful! You are now logged in.');
            showApp();
        } else if (status === 409) {
            alert('Username already exists. Please choose a different username or login instead.');
        } else {
            alert(data.error || 'Registration failed. Please try again.');
        }
    })
    .catch((e) => {
        const msg = (e && e.name === 'AbortError') ? 'Network timeout reaching backend' : (e && e.message) ? e.message : 'Registration failed';
        alert(msg + '. Please ensure the server is running at ' + BACKEND_URL);
    });
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        // Clear any cached data references
        if (typeof window !== 'undefined') {
            // Clear global variables that might hold user data
            if (typeof currentProject !== 'undefined') {
                currentProject = null;
            }
            if (typeof currentEngineer !== 'undefined') {
                currentEngineer = null;
            }
            if (typeof currentDealer !== 'undefined') {
                currentDealer = null;
            }
        }
        
        AUTH_TOKEN = null;
        setCurrentUser(null);
        showAuth();
    }
}

// Initialize auth on load
document.addEventListener('DOMContentLoaded', function() {
    (async function() {
        try {
            await detectBackendUrl();
            initAuth();
            
            // Allow Enter key to submit forms
            const loginPasswordEl = document.getElementById('login-password');
            const registerConfirmEl = document.getElementById('register-confirm');
            
            if (loginPasswordEl) {
                loginPasswordEl.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleLogin();
                    }
                });
            }
            
            if (registerConfirmEl) {
                registerConfirmEl.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleRegister();
                    }
                });
            }
        } catch (e) {
            console.error('Error initializing auth:', e);
            alert('Unable to reach backend. Please ensure the server is running.');
            initAuth();
        }
    })();
});

/* ===== app.js ===== */
// Main Application Logic

let currentProject = null;
let currentEngineer = null;
let currentDealer = null;

// Initialize app
function init() {
    // Don't migrate here - wait for user to be logged in
    // Migration will happen in showApp() after login
    if (getCurrentUser()) {
        // User is logged in, migrate their data
        if (typeof migrateOldData === 'function') {
            migrateOldData();
        }
        renderDealers();
    }
}

// Render functions
function renderDealers() {
    const container = document.getElementById('dealers-container');
    if (!container) {
        console.error('Dealers container not found');
        return;
    }
    
    // Check if user is logged in
    if (!getCurrentUser()) {
        container.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px; font-size: 18px;">Please login to view your data.</p>';
        return;
    }
    
    const dealers = getDealers();
    
    if (Object.keys(dealers).length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px; font-size: 18px;">No dealers yet. Click "Add Dealer" to get started.</p>';
        return;
    }

    container.innerHTML = Object.keys(dealers).map(dealerName => {
        const dealer = dealers[dealerName];
        return `
            <div class="card">
                <div class="card-header" onclick="toggleCard('dealer-${escapeHtml(dealerName)}')">
                    <span class="chevron" id="chevron-dealer-${escapeHtml(dealerName)}">▶</span>
                    <h3>${escapeHtml(dealerName)}</h3>
                    <div>
                        <button class="btn btn-edit btn-small" onclick="event.stopPropagation(); editDealer('${escapeHtml(dealerName)}')">Edit</button>
                        <button class="btn btn-add btn-small" onclick="event.stopPropagation(); showAddCategoryForm('${escapeHtml(dealerName)}')">+ Category</button>
                        <button class="btn btn-delete btn-small" onclick="event.stopPropagation(); deleteDealer('${escapeHtml(dealerName)}')">Delete</button>
                    </div>
                </div>
                <div class="card-body" id="dealer-${escapeHtml(dealerName)}">
                    ${renderCategories(dealerName, dealer)}
                </div>
            </div>
        `;
    }).join('');
}

function renderCategories(dealerName, dealer) {
    const categories = ['Sub Dealer', 'Engineer', 'Contractor'];
    
    // Ensure all categories are initialized
    const dealers = getDealers();
    if (dealers[dealerName]) {
        categories.forEach(category => {
            if (!dealers[dealerName][category]) {
                dealers[dealerName][category] = [];
            }
        });
        // Save if we made changes
        const needsSave = categories.some(cat => !dealer[cat]);
        if (needsSave) {
            saveDealers(dealers);
        }
    }
    
    return categories.map(category => {
        const entries = dealer[category] || [];
        return `
            <div class="category-section">
                <div class="category-header">
                    <h4>${category}</h4>
                    <button class="btn btn-add btn-small" onclick="showAddEntryForm('${escapeHtml(dealerName)}', '${category}')">+ Add</button>
                </div>
                <div id="category-${escapeHtml(dealerName)}-${category}">
                    ${entries.map((entry, idx) => renderEntry(dealerName, category, entry, idx)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderEntry(dealerName, category, entry, idx) {
    const isVisited = entry.visitHistory && entry.visitHistory.length > 0;
    const visitedIndicator = `<span class="visited-indicator ${isVisited ? 'visited' : 'not-visited'}" title="${isVisited ? 'Visited' : 'Not Visited'}"></span>`;
    
    if (category === 'Engineer') {
        return renderEngineerEntry(dealerName, entry, idx, visitedIndicator);
    }
    return `
        <div class="entry-card">
            ${visitedIndicator}
            <div class="entry-field"><label>Name:</label><span>${escapeHtml(entry.name || '')}</span></div>
            ${entry.company ? `<div class="entry-field"><label>Company:</label><span>${escapeHtml(entry.company)}</span></div>` : ''}
            ${entry.phone ? `<div class="entry-field"><label>Phone:</label><span>${escapeHtml(entry.phone)}</span></div>` : ''}
            ${entry.place ? `<div class="entry-field"><label>Place:</label><span>${escapeHtml(entry.place)}</span></div>` : ''}
            ${entry.note ? `<div class="entry-field"><label>Note:</label><span>${escapeHtml(entry.note)}</span></div>` : ''}
            ${entry.address ? `<div class="entry-field"><label>Address:</label><span>${escapeHtml(entry.address)}</span></div>` : ''}
            ${entry.email ? `<div class="entry-field"><label>Email:</label><span>${escapeHtml(entry.email)}</span></div>` : ''}
            ${entry.visitHistory && entry.visitHistory.length > 0 ? `
                <div class="visit-history">
                    <label>Visit History:</label>
                    ${entry.visitHistory.map(date => `<span class="visit-date">${escapeHtml(date)}</span>`).join('')}
                </div>
            ` : ''}
            <div style="margin-top: 10px;">
                <button class="btn btn-edit btn-small" onclick="editEntry('${escapeHtml(dealerName)}', '${category}', ${idx})">Edit</button>
                <button class="btn btn-delete btn-small" onclick="deleteEntry('${escapeHtml(dealerName)}', '${category}', ${idx})">Delete</button>
                <button class="btn btn-add btn-small" onclick="addVisitDate('${escapeHtml(dealerName)}', '${category}', ${idx})">+ Visit Date</button>
            </div>
        </div>
    `;
}

function renderEngineerEntry(dealerName, entry, idx, visitedIndicator) {
    const projects = entry.projects || [];
    return `
        <div class="entry-card">
            ${visitedIndicator}
            <div class="entry-field"><label>Name:</label><span>${escapeHtml(entry.name || '')}</span></div>
            ${entry.company ? `<div class="entry-field"><label>Company:</label><span>${escapeHtml(entry.company)}</span></div>` : ''}
            ${entry.phone ? `<div class="entry-field"><label>Phone:</label><span>${escapeHtml(entry.phone)}</span></div>` : ''}
            ${entry.place ? `<div class="entry-field"><label>Place:</label><span>${escapeHtml(entry.place)}</span></div>` : ''}
            ${entry.note ? `<div class="entry-field"><label>Note:</label><span>${escapeHtml(entry.note)}</span></div>` : ''}
            ${entry.address ? `<div class="entry-field"><label>Address:</label><span>${escapeHtml(entry.address)}</span></div>` : ''}
            ${entry.email ? `<div class="entry-field"><label>Email:</label><span>${escapeHtml(entry.email)}</span></div>` : ''}
            ${entry.visitHistory && entry.visitHistory.length > 0 ? `
                <div class="visit-history">
                    <label>Visit History:</label>
                    ${entry.visitHistory.map(date => `<span class="visit-date">${escapeHtml(date)}</span>`).join('')}
                </div>
            ` : ''}
            <div class="projects-list">
                <label style="font-weight: bold; display: block; margin: 10px 0;">Projects:</label>
                ${projects.map((project, pIdx) => {
                    const projectProgress = calculateProjectProgress(project);
                    return `
                        <a href="#" class="project-link" onclick="openWorkTracker('${escapeHtml(dealerName)}', ${idx}, ${pIdx}); return false;">
                            ${escapeHtml(project.name)} (${escapeHtml(project.type || 'Concrete')}) - ${projectProgress}%
                        </a>
                    `;
                }).join('')}
                <button class="btn btn-add btn-small" onclick="showAddProjectForm('${escapeHtml(dealerName)}', ${idx})" style="margin-top: 10px;">+ Add Project</button>
            </div>
            <div style="margin-top: 10px;">
                <button class="btn btn-edit btn-small" onclick="editEntry('${escapeHtml(dealerName)}', 'Engineer', ${idx})">Edit</button>
                <button class="btn btn-delete btn-small" onclick="deleteEntry('${escapeHtml(dealerName)}', 'Engineer', ${idx})">Delete</button>
                <button class="btn btn-add btn-small" onclick="addVisitDate('${escapeHtml(dealerName)}', 'Engineer', ${idx})">+ Visit Date</button>
            </div>
        </div>
    `;
}

function calculateProjectProgress(project) {
    if (!project.floors || project.floors.length === 0) return 0;
    let totalTasks = 0;
    let completedTasks = 0;
    
    project.floors.forEach(floor => {
        if (floor.tasks) {
            totalTasks += floor.tasks.length;
            completedTasks += floor.tasks.filter(t => t.completed).length;
        }
    });
    
    return totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
}

// Dealer CRUD
function showAddDealerForm() {
    document.getElementById('dealerNameInput').value = '';
    document.getElementById('addDealerModal').classList.add('active');
}

function addDealer() {
    const name = document.getElementById('dealerNameInput').value.trim();
    if (!name) {
        alert('Please enter a dealer name');
        return;
    }

    // Check if user is logged in
    if (!getCurrentUser()) {
        alert('Error: Please login first.');
        return;
    }

    const dealers = getDealers();
    if (dealers[name]) {
        alert('Dealer already exists');
        return;
    }

    // Initialize dealer with all categories
    dealers[name] = {
        'Sub Dealer': [],
        'Engineer': [],
        'Contractor': []
    };

    saveDealers(dealers);
    closeModal('addDealerModal');
    renderDealers();
    // Update dashboard if visible
    if (typeof updateDashboard === 'function' && !document.getElementById('dashboard-section').classList.contains('hidden')) {
        updateDashboard();
    }
}

function editDealer(oldName) {
    const newName = prompt('Enter new dealer name:', oldName);
    if (!newName || newName.trim() === '') return;

    const dealers = getDealers();
    if (dealers[newName] && newName !== oldName) {
        alert('Dealer name already exists');
        return;
    }

    dealers[newName] = dealers[oldName];
    delete dealers[oldName];
    saveDealers(dealers);
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

function deleteDealer(name) {
    if (!confirm(`Delete dealer "${name}"?`)) return;

    const dealers = getDealers();
    delete dealers[name];
    saveDealers(dealers);
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

// Category management
function showAddCategoryForm(dealerName) {
    const category = prompt('Enter category name (Sub Dealer, Engineer, or Contractor):');
    if (!category) return;

    const validCategories = ['Sub Dealer', 'Engineer', 'Contractor'];
    if (!validCategories.includes(category)) {
        alert('Invalid category. Use: Sub Dealer, Engineer, or Contractor');
        return;
    }

    const dealers = getDealers();
    
    // Ensure dealer exists
    if (!dealers[dealerName]) {
        alert('Error: Dealer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    // Initialize category if it doesn't exist
    if (!dealers[dealerName][category]) {
        dealers[dealerName][category] = [];
    }
    saveDealers(dealers);
    renderDealers();
}

// Entry CRUD
function showAddEntryForm(dealerName, category) {
    const formHtml = category === 'Engineer' 
        ? getEngineerForm(dealerName, category, null, null)
        : getGenericEntryForm(dealerName, category, null, null);
    
    const formDiv = document.createElement('div');
    formDiv.className = 'inline-form';
    formDiv.innerHTML = formHtml;
    
    const container = document.getElementById(`category-${escapeHtml(dealerName)}-${category}`);
    container.appendChild(formDiv);
}

function getEngineerForm(dealerName, category, entry, idx) {
    const isEdit = entry !== null;
    return `
        <h4>${isEdit ? 'Edit' : 'Add'} Engineer</h4>
        <div class="form-group">
            <label>Name:</label>
            <input type="text" id="entry-name-${idx || 'new'}" value="${entry ? escapeHtml(entry.name || '') : ''}" required>
        </div>
        <div class="form-group">
            <label>Company:</label>
            <input type="text" id="entry-company-${idx || 'new'}" value="${entry ? escapeHtml(entry.company || '') : ''}">
        </div>
        <div class="form-group">
            <label>Phone:</label>
            <input type="text" id="entry-phone-${idx || 'new'}" value="${entry ? escapeHtml(entry.phone || '') : ''}">
        </div>
        <div class="form-group">
            <label>Place:</label>
            <input type="text" id="entry-place-${idx || 'new'}" value="${entry ? escapeHtml(entry.place || '') : ''}">
        </div>
        <div class="form-group">
            <label>Note:</label>
            <textarea id="entry-note-${idx || 'new'}">${entry ? escapeHtml(entry.note || '') : ''}</textarea>
        </div>
        <div class="form-group">
            <label>Address:</label>
            <textarea id="entry-address-${idx || 'new'}">${entry ? escapeHtml(entry.address || '') : ''}</textarea>
        </div>
        <div class="form-group">
            <label>Email:</label>
            <input type="email" id="entry-email-${idx || 'new'}" value="${entry ? escapeHtml(entry.email || '') : ''}">
        </div>
        <div class="form-actions">
            <button class="btn btn-add" onclick="saveEntry('${escapeHtml(dealerName)}', '${category}', ${idx !== null ? idx : 'null'})">Save</button>
            <button class="btn btn-delete" onclick="cancelEntryForm('${escapeHtml(dealerName)}', '${category}', ${idx !== null ? idx : 'null'})">Cancel</button>
        </div>
    `;
}

function getGenericEntryForm(dealerName, category, entry, idx) {
    const isEdit = entry !== null;
    return `
        <h4>${isEdit ? 'Edit' : 'Add'} ${category}</h4>
        <div class="form-group">
            <label>Name:</label>
            <input type="text" id="entry-name-${idx || 'new'}" value="${entry ? escapeHtml(entry.name || '') : ''}" required>
        </div>
        <div class="form-group">
            <label>Company:</label>
            <input type="text" id="entry-company-${idx || 'new'}" value="${entry ? escapeHtml(entry.company || '') : ''}">
        </div>
        <div class="form-group">
            <label>Phone:</label>
            <input type="text" id="entry-phone-${idx || 'new'}" value="${entry ? escapeHtml(entry.phone || '') : ''}">
        </div>
        <div class="form-group">
            <label>Place:</label>
            <input type="text" id="entry-place-${idx || 'new'}" value="${entry ? escapeHtml(entry.place || '') : ''}">
        </div>
        <div class="form-group">
            <label>Note:</label>
            <textarea id="entry-note-${idx || 'new'}">${entry ? escapeHtml(entry.note || '') : ''}</textarea>
        </div>
        <div class="form-group">
            <label>Address:</label>
            <textarea id="entry-address-${idx || 'new'}">${entry ? escapeHtml(entry.address || '') : ''}</textarea>
        </div>
        <div class="form-group">
            <label>Email:</label>
            <input type="email" id="entry-email-${idx || 'new'}" value="${entry ? escapeHtml(entry.email || '') : ''}">
        </div>
        <div class="form-actions">
            <button class="btn btn-add" onclick="saveEntry('${escapeHtml(dealerName)}', '${category}', ${idx !== null ? idx : 'null'})">Save</button>
            <button class="btn btn-delete" onclick="cancelEntryForm('${escapeHtml(dealerName)}', '${category}', ${idx !== null ? idx : 'null'})">Cancel</button>
        </div>
    `;
}

function saveEntry(dealerName, category, idx) {
    try {
        const dealers = getDealers();
        
        // Ensure dealer exists
        if (!dealers[dealerName]) {
            alert('Error: Dealer not found. Please refresh the page.');
            renderDealers();
            return;
        }
        
        // Ensure category exists and is initialized
        if (!dealers[dealerName][category]) {
            dealers[dealerName][category] = [];
            saveDealers(dealers);
        }
        
        const id = idx !== null ? idx : 'new';
        const nameEl = document.getElementById(`entry-name-${id}`);
        if (!nameEl) {
            alert('Error: Form elements not found');
            return;
        }
        
        const entry = {
            name: nameEl.value.trim(),
            company: document.getElementById(`entry-company-${id}`)?.value.trim() || '',
            phone: document.getElementById(`entry-phone-${id}`)?.value.trim() || '',
            place: document.getElementById(`entry-place-${id}`)?.value.trim() || '',
            note: document.getElementById(`entry-note-${id}`)?.value.trim() || '',
            address: document.getElementById(`entry-address-${id}`)?.value.trim() || '',
            email: document.getElementById(`entry-email-${id}`)?.value.trim() || '',
            visitHistory: idx !== null && dealers[dealerName][category][idx] 
                ? (dealers[dealerName][category][idx].visitHistory || [])
                : []
        };

        if (category === 'Engineer') {
            entry.projects = idx !== null && dealers[dealerName][category][idx]
                ? (dealers[dealerName][category][idx].projects || [])
                : [];
        }

        if (!entry.name) {
            alert('Name is required');
            return;
        }

        if (idx !== null) {
            if (idx >= dealers[dealerName][category].length) {
                alert('Error: Invalid entry index');
                return;
            }
            dealers[dealerName][category][idx] = entry;
        } else {
            dealers[dealerName][category].push(entry);
        }

        saveDealers(dealers);
        renderDealers();
        if (typeof updateDashboard === 'function') updateDashboard();
    } catch (e) {
        console.error('Error saving entry:', e);
        alert('Error saving entry. Please try again.');
    }
}

function editEntry(dealerName, category, idx) {
    const dealers = getDealers();
    
    // Validate dealer and category exist
    if (!dealers[dealerName]) {
        alert('Error: Dealer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category]) {
        dealers[dealerName][category] = [];
        saveDealers(dealers);
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category][idx]) {
        alert('Error: Entry not found.');
        renderDealers();
        return;
    }
    
    const entry = dealers[dealerName][category][idx];
    
    const formHtml = category === 'Engineer'
        ? getEngineerForm(dealerName, category, entry, idx)
        : getGenericEntryForm(dealerName, category, entry, idx);
    
    const container = document.getElementById(`category-${escapeHtml(dealerName)}-${category}`);
    if (!container) {
        alert('Error: Container not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    const entryCard = container.children[idx];
    if (!entryCard) {
        alert('Error: Entry card not found.');
        renderDealers();
        return;
    }
    
    const formDiv = document.createElement('div');
    formDiv.className = 'inline-form';
    formDiv.innerHTML = formHtml;
    entryCard.style.display = 'none';
    container.insertBefore(formDiv, entryCard);
}

function cancelEntryForm(dealerName, category, idx) {
    if (idx !== null) {
        const container = document.getElementById(`category-${escapeHtml(dealerName)}-${category}`);
        const formDiv = container.querySelector('.inline-form');
        if (formDiv) {
            formDiv.remove();
            container.children[idx].style.display = 'block';
        }
    } else {
        const container = document.getElementById(`category-${escapeHtml(dealerName)}-${category}`);
        const formDiv = container.querySelector('.inline-form');
        if (formDiv) {
            formDiv.remove();
        }
    }
}

function deleteEntry(dealerName, category, idx) {
    if (!confirm('Delete this entry?')) return;

    const dealers = getDealers();
    
    // Validate dealer and category exist
    if (!dealers[dealerName]) {
        alert('Error: Dealer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category]) {
        alert('Error: Category not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (idx >= dealers[dealerName][category].length) {
        alert('Error: Entry not found.');
        renderDealers();
        return;
    }
    
    dealers[dealerName][category].splice(idx, 1);
    saveDealers(dealers);
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

function addVisitDate(dealerName, category, idx) {
    const date = prompt('Enter visit date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    if (!date) return;

    const dealers = getDealers();
    
    // Validate dealer and category exist
    if (!dealers[dealerName]) {
        alert('Error: Dealer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category]) {
        alert('Error: Category not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category][idx]) {
        alert('Error: Entry not found.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName][category][idx].visitHistory) {
        dealers[dealerName][category][idx].visitHistory = [];
    }
    dealers[dealerName][category][idx].visitHistory.push(date);
    saveDealers(dealers);
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

// Project management
function showAddProjectForm(dealerName, engineerIdx) {
    const name = prompt('Enter project name:');
    if (!name) return;

    const type = prompt('Enter project type (Concrete or SSM):', 'Concrete');
    if (!type || !['Concrete', 'SSM'].includes(type)) {
        alert('Type must be Concrete or SSM');
        return;
    }

    const dealers = getDealers();
    
    // Validate dealer exists
    if (!dealers[dealerName]) {
        alert('Error: Dealer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    // Ensure Engineer category exists
    if (!dealers[dealerName]['Engineer']) {
        dealers[dealerName]['Engineer'] = [];
        saveDealers(dealers);
        renderDealers();
        return;
    }
    
    // Validate engineer exists
    if (!dealers[dealerName]['Engineer'][engineerIdx]) {
        alert('Error: Engineer not found. Please refresh the page.');
        renderDealers();
        return;
    }
    
    if (!dealers[dealerName]['Engineer'][engineerIdx].projects) {
        dealers[dealerName]['Engineer'][engineerIdx].projects = [];
    }

    const project = {
        name: name.trim(),
        type: type,
        workingProcess: '',
        floors: [],
        history: []
    };

    dealers[dealerName]['Engineer'][engineerIdx].projects.push(project);
    const projectIdx = dealers[dealerName]['Engineer'][engineerIdx].projects.length - 1;
    addHistory(dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx], null, `Project "${name}" created`);
    saveDealers(dealers);
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

// Work Tracker
function openWorkTracker(dealerName, engineerIdx, projectIdx) {
    try {
        const dealers = getDealers();
        if (!dealers[dealerName] || !dealers[dealerName]['Engineer'] || !dealers[dealerName]['Engineer'][engineerIdx]) {
            alert('Error: Engineer not found');
            return;
        }
        
        const engineer = dealers[dealerName]['Engineer'][engineerIdx];
        if (!engineer.projects || !engineer.projects[projectIdx]) {
            alert('Error: Project not found');
            return;
        }
        
        const project = engineer.projects[projectIdx];
        
        currentProject = project;
        currentEngineer = { dealerName, engineerIdx, projectIdx };
        currentDealer = dealers[dealerName];

        const titleEl = document.getElementById('workTrackerTitle');
        const contentEl = document.getElementById('workTrackerContent');
        const modalEl = document.getElementById('workTrackerModal');
        
        if (!titleEl || !contentEl || !modalEl) {
            alert('Error: Work tracker elements not found');
            return;
        }

        titleEl.textContent = `${project.name} - ${project.type} Work Tracker`;
        contentEl.innerHTML = renderWorkTracker(project);
        modalEl.classList.add('active');
    } catch (e) {
        console.error('Error opening work tracker:', e);
        alert('Error opening work tracker. Please try again.');
    }
}

function renderWorkTracker(project) {
    const hasGroundFloor = project.floors && project.floors.some(f => f.name === 'Ground Floor');
    
    return `
        <div class="work-tracker-grid">
            <div class="floors-section">
                <div class="form-group">
                    <label>Working Process:</label>
                    <textarea id="working-process" oninput="saveWorkingProcess()">${escapeHtml(project.workingProcess || '')}</textarea>
                </div>
                
                <div style="margin: 20px 0;">
                    ${!hasGroundFloor ? `<button class="btn btn-add" onclick="addFloor('Ground Floor', true)">+ Add Ground Floor</button>` : ''}
                    <button class="btn btn-add" onclick="addFloor('', false)">+ Add Floor</button>
                </div>

                <div id="floors-container">
                    ${(project.floors || []).map((floor, fIdx) => renderFloor(floor, fIdx, project.type)).join('')}
                </div>

                <div style="margin-top: 20px;">
                    <button class="btn btn-add" onclick="exportProjectJSON()">Export JSON</button>
                    <button class="btn btn-delete" onclick="deleteProject()">Delete Project</button>
                </div>
            </div>

            <div class="history-panel">
                <h3>History Log</h3>
                <div id="history-container">
                    ${renderHistory(project.history || [])}
                </div>
            </div>
        </div>
    `;
}

function renderHistory(history) {
    // Reverse history to show newest first
    const reversedHistory = [...history].reverse();
    return reversedHistory.map(h => `
        <div class="history-item">
            <div class="history-time">${escapeHtml(h.timestamp)}</div>
            <div class="history-action">${escapeHtml(h.action)}</div>
        </div>
    `).join('');
}

function renderFloor(floor, fIdx, projectType) {
    const isGround = floor.name === 'Ground Floor';
    const tasks = floor.tasks || [];
    const completion = calculateFloorCompletion(floor);
    const isCompleted = isFloorCompleted(floor);
    const completedClass = isCompleted ? 'completed' : '';
    
    return `
        <div class="floor-card ${completedClass}">
            <div class="floor-header">
                <span>${escapeHtml(floor.name || `Floor ${fIdx + 1}`)} ${isCompleted ? '✓ Completed' : ''}</span>
                <div>
                    <button class="btn btn-edit btn-small" onclick="editFloorName(${fIdx})">Rename</button>
                    ${!isGround ? `<button class="btn btn-delete btn-small" onclick="deleteFloor(${fIdx})">Delete</button>` : ''}
                </div>
            </div>
            <div class="floor-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${completion}%">${completion}%</div>
                </div>
            </div>
            <div class="form-group">
                <label>Floor Notes:</label>
                <textarea id="floor-notes-${fIdx}" oninput="saveFloorNotes(${fIdx})">${escapeHtml(floor.notes || '')}</textarea>
            </div>
            <div>
                <button class="btn btn-add btn-small" onclick="addTask(${fIdx})">+ Add Task</button>
            </div>
            <div id="tasks-${fIdx}">
                ${tasks.map((task, tIdx) => renderTask(fIdx, task, tIdx)).join('')}
            </div>
        </div>
    `;
}

function renderTask(floorIdx, task, taskIdx) {
    const completedClass = task.completed ? 'completed' : '';
    return `
        <div class="task-item ${completedClass}">
            <input type="checkbox" id="task-${floorIdx}-${taskIdx}" ${task.completed ? 'checked' : ''} 
                   onchange="toggleTask(${floorIdx}, ${taskIdx})">
            <label for="task-${floorIdx}-${taskIdx}">${escapeHtml(task.name || '')}</label>
            <div class="task-actions">
                <button class="btn btn-edit btn-small" onclick="editTask(${floorIdx}, ${taskIdx})">Edit</button>
                <button class="btn btn-delete btn-small" onclick="deleteTask(${floorIdx}, ${taskIdx})">Delete</button>
            </div>
        </div>
    `;
}

function addFloor(name, isGround) {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    
    if (!project.floors) {
        project.floors = [];
    }

    let floorName = name;
    if (!floorName) {
        const floorNum = project.floors.length;
        floorName = `Floor ${floorNum}`;
    }

    const floor = {
        name: floorName,
        notes: '',
        tasks: []
    };

    if (isGround) {
        const taskTemplates = getTaskTemplates(project.type, true);
        floor.tasks = taskTemplates.map(t => ({ name: t, completed: false }));
    }

    project.floors.push(floor);
    addHistory(project, null, `Floor "${floorName}" added`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function getTaskTemplates(type, isGround) {
    if (type === 'Concrete') {
        return isGround 
            ? ['bed concrete', 'pedestal', 'plinth', 'column', 'masonry', 'lintel', 'slab']
            : ['column', 'masonry', 'lintel', 'slab'];
    } else if (type === 'SSM') {
        return isGround
            ? ['bed concrete', 'ssm masonry', 'dpc', 'plinth']
            : ['ssm masonry', 'dpc', 'plinth'];
    }
    return [];
}

function editFloorName(floorIdx) {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    const floor = project.floors[floorIdx];
    
    const newName = prompt('Enter new floor name:', floor.name);
    if (!newName || newName.trim() === '') return;

    const oldName = floor.name;
    floor.name = newName.trim();
    addHistory(project, null, `Floor renamed from "${oldName}" to "${newName}"`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function deleteFloor(floorIdx) {
    if (!confirm('Delete this floor?')) return;

    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    const floorName = project.floors[floorIdx].name;
    
    project.floors.splice(floorIdx, 1);
    addHistory(project, null, `Floor "${floorName}" deleted`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function saveFloorNotes(floorIdx) {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    
    const notes = document.getElementById(`floor-notes-${floorIdx}`).value;
    project.floors[floorIdx].notes = notes;
    saveDealers(dealers);
    currentProject = project;
}

function addTask(floorIdx) {
    const taskName = prompt('Enter task name:');
    if (!taskName || taskName.trim() === '') return;

    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    
    if (!project.floors[floorIdx].tasks) {
        project.floors[floorIdx].tasks = [];
    }

    project.floors[floorIdx].tasks.push({
        name: taskName.trim(),
        completed: false
    });

    addHistory(project, null, `Task "${taskName}" added to ${project.floors[floorIdx].name}`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function toggleTask(floorIdx, taskIdx) {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    const task = project.floors[floorIdx].tasks[taskIdx];
    
    task.completed = !task.completed;
    const status = task.completed ? 'completed' : 'unchecked';
    addHistory(project, null, `Task "${task.name}" ${status} on ${project.floors[floorIdx].name}`);
    
    // Check if floor is now completed
    const floor = project.floors[floorIdx];
    if (isFloorCompleted(floor) && !floor.completed) {
        floor.completed = true;
        addHistory(project, null, `Floor "${floor.name}" completed!`);
    }
    
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function editTask(floorIdx, taskIdx) {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    const task = project.floors[floorIdx].tasks[taskIdx];
    
    const newName = prompt('Enter new task name:', task.name);
    if (!newName || newName.trim() === '') return;

    const oldName = task.name;
    task.name = newName.trim();
    addHistory(project, null, `Task renamed from "${oldName}" to "${newName}"`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function deleteTask(floorIdx, taskIdx) {
    if (!confirm('Delete this task?')) return;

    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    const taskName = project.floors[floorIdx].tasks[taskIdx].name;
    const floorName = project.floors[floorIdx].name;
    
    project.floors[floorIdx].tasks.splice(taskIdx, 1);
    addHistory(project, null, `Task "${taskName}" deleted from ${floorName}`);
    saveDealers(dealers);
    currentProject = project;
    document.getElementById('workTrackerContent').innerHTML = renderWorkTracker(project);
    // Update charts if dashboard is visible
    if (typeof window.updateCharts === 'function') {
        window.updateCharts();
    }
}

function saveWorkingProcess() {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    
    const workingProcess = document.getElementById('working-process').value;
    project.workingProcess = workingProcess;
    saveDealers(dealers);
    currentProject = project;
}

function addHistory(project, taskIdx, action) {
    if (!project.history) {
        project.history = [];
    }
    project.history.push({
        timestamp: new Date().toLocaleString(),
        action: action
    });
    // Keep last 200 entries
    if (project.history.length > 200) {
        project.history.shift();
    }
}

function updateHistoryDisplay(project) {
    const container = document.getElementById('history-container');
    container.innerHTML = renderHistory(project.history || []);
}

function exportProjectJSON() {
    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    const project = dealers[dealerName]['Engineer'][engineerIdx].projects[projectIdx];
    
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_export.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function deleteProject() {
    if (!confirm('Delete this project? This cannot be undone.')) return;

    const dealers = getDealers();
    const { dealerName, engineerIdx, projectIdx } = currentEngineer;
    
    dealers[dealerName]['Engineer'][engineerIdx].projects.splice(projectIdx, 1);
    saveDealers(dealers);
    closeWorkTracker();
    renderDealers();
    if (typeof updateDashboard === 'function') updateDashboard();
}

function closeWorkTracker() {
    document.getElementById('workTrackerModal').classList.remove('active');
    currentProject = null;
    currentEngineer = null;
}

// Close modal on outside click
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.classList.remove('active');
        }
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
    init();
});



