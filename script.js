// Update current time
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    document.getElementById('current-time').textContent = timeString;
}

setInterval(updateTime, 1000);
updateTime();

// Navigation functionality
function showSection(section) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    event.target.classList.add('active');
    
    // You can add logic here to show/hide different sections
    console.log('Showing section:', section);
}

// Initialize Chart.js
const ctx = document.getElementById('lineChart').getContext('2d');
const lineChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [{
            label: 'Revenue (₹)',
            data: [120000, 190000, 150000, 250000, 220000, 300000],
            borderColor: 'rgba(255, 255, 255, 0.8)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.8)'
                }
            },
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.8)'
                }
            }
        },
        plugins: {
            legend: {
                labels: {
                    color: 'rgba(255, 255, 255, 0.8)'
                }
            }
        }
    }
});

// Animate numbers on load
function animateValue(element, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        
        if (element.id === 'revenue-count') {
            element.textContent = '₹' + current.toLocaleString('en-IN');
        } else if (element.id === 'conversion-rate') {
            element.textContent = (current / 100).toFixed(1) + '%';
        } else {
            element.textContent = current.toLocaleString();
        }
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// Animate stats on page load
window.addEventListener('load', () => {
    animateValue(document.getElementById('users-count'), 0, 1234, 2000);
    animateValue(document.getElementById('revenue-count'), 0, 456789, 2000);
    animateValue(document.getElementById('orders-count'), 0, 456, 2000);
    animateValue(document.getElementById('conversion-rate'), 0, 320, 2000);
});

// Add new activity periodically
const activities = [
    'New user registration',
    'Order completed',
    'Payment received',
    'System update',
    'Backup completed',
    'New message received'
];

function addNewActivity() {
    const activityList = document.getElementById('activity-list');
    const randomActivity = activities[Math.floor(Math.random() * activities.length)];
    
    const newActivity = document.createElement('div');
    newActivity.className = 'activity-item';
    newActivity.innerHTML = `
        <div>${randomActivity}</div>
        <div class="activity-time">Just now</div>
    `;
    
    activityList.insertBefore(newActivity, activityList.firstChild);
    
    // Remove oldest activity if more than 6
    if (activityList.children.length > 6) {
        activityList.removeChild(activityList.lastChild);
    }
}

// Add new activity every 30 seconds
setInterval(addNewActivity, 30000);