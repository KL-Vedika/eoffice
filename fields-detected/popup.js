document.addEventListener('DOMContentLoaded', function() {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusDiv = document.getElementById('status');
  const summaryDiv = document.getElementById('summary');
  const resultsDiv = document.getElementById('results');

  let currentAnalysisData = null;

  // Show status message
  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-hide success/info messages
    if (type !== 'error') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }

  // Update summary stats
  function updateSummary(data) {
    if (!data || !data.summary) {
      summaryDiv.style.display = 'none';
      return;
    }

    document.getElementById('totalFields').textContent = data.summary.totalFields;
    document.getElementById('issuesFound').textContent = data.summary.issuesFound;
    document.getElementById('angularFields').textContent = data.summary.angularFields;
    
    summaryDiv.style.display = 'block';
  }

  // Render field analysis results
  function renderResults(data) {
    if (!data || !data.fields || data.fields.length === 0) {
      resultsDiv.innerHTML = '<div class="no-results">No form fields found on page</div>';
      return;
    }

    let html = '';
    data.fields.forEach(field => {
      html += `
        <div class="field-item">
          <div class="field-header">
            <div class="field-name">${field.name || 'Unnamed Field'}</div>
            <div class="field-type">${field.type}${field.isAngular ? ' (Angular)' : ''}</div>
          </div>
          <ul class="check-list">
      `;

      field.checks.forEach(check => {
        html += `
          <li class="check-item">
            <div class="check-status ${check.status}">
              ${check.status === 'success' ? '✓' : check.status === 'warning' ? '!' : '✗'}
            </div>
            <div class="check-details">
              <div class="check-title">${check.title}</div>
              <div class="check-description">${check.description}</div>
            </div>
          </li>
        `;
      });

      html += `
          </ul>
        </div>
      `;
    });

    resultsDiv.innerHTML = html;
  }

  // Format data for JSON export
  function formatDataForExport(tabUrl = 'unknown') {
    if (!currentAnalysisData) return null;

    const timestamp = new Date().toISOString();

    return {
      metadata: {
        timestamp: timestamp,
        url: tabUrl,
        exportedBy: 'Fields Detector Extension',
        version: '1.0'
      },
      analysis: {
        summary: currentAnalysisData.summary,
        pageInfo: {
          totalFields: currentAnalysisData.summary.totalFields,
          angularFields: currentAnalysisData.summary.angularFields,
          issuesFound: currentAnalysisData.summary.issuesFound,
          hasAngular: currentAnalysisData.summary.angularFields > 0
        },
        fields: currentAnalysisData.fields.map(field => ({
          fieldInfo: {
            name: field.name || 'unnamed',
            type: field.type,
            isAngular: field.isAngular,
            totalIssues: field.issues
          },
          checks: field.checks.map(check => ({
            title: check.title,
            status: check.status,
            description: check.description,
            isPassing: check.status === 'success',
            needsAttention: check.status === 'error'
          })),
          recommendations: field.checks
            .filter(check => check.status !== 'success')
            .map(check => ({
              issue: check.title,
              severity: check.status,
              recommendation: getRecommendation(check.title, check.status)
            }))
        }))
      }
    };
  }

  // Get recommendations for issues
  function getRecommendation(checkTitle, status) {
    const recommendations = {
      'Selector Usage': 'Add name, id, or formControlName attributes to the field',
      'Event Handling': 'Add (input), (change), and (blur) event handlers',
      'Change Detection': 'Ensure field is within Angular zone or manually trigger detection',
      'Form Control State': 'Use Angular Reactive Forms or Template-driven forms',
      'Event Bubbling': 'Avoid using .stop() on events unless necessary',
      'Select Options': 'Add options to select element or check dynamic option loading',
      'Dynamic Rendering': 'Use MutationObserver or delay form filling for *ngIf/*ngFor elements',
      'Event Trust': 'Use NgZone.run() for trusted events or access FormControl directly',
      'Value Persistence': 'Use two-way binding [(ngModel)] or Reactive Forms',
      'FormControl Integration': 'Use formGroup and formControlName for better integration',
      'Component Access': 'Enable Angular development mode for ng.getComponent access'
    };

    return recommendations[checkTitle] || 'Review field configuration and Angular integration';
  }

  // Download JSON file
  async function downloadAnalysisData() {
    if (!currentAnalysisData) {
      showStatus('No analysis data available to download', 'error');
      return;
    }

    try {
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab ? tab.url : 'unknown';
      
      const exportData = formatDataForExport(tabUrl);
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `fields-analysis-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up object URL
      URL.revokeObjectURL(url);
      
      showStatus('✅ Analysis data downloaded successfully', 'success');
    } catch (error) {
      console.error('Download error:', error);
      showStatus(`❌ Download failed: ${error.message}`, 'error');
    }
  }

  // Analyze fields
  async function analyzeFields() {
    try {
      // Disable buttons and show loading state
      analyzeBtn.disabled = true;
      downloadBtn.disabled = true;
      analyzeBtn.textContent = 'Analyzing...';
      showStatus('Analyzing form fields...', 'info');

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('No active tab found');
      }

      // Send analyze message to content script
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'analyzeFields' });
      } catch (messageError) {
        console.error('Message sending error:', messageError);
        throw new Error(`Content script not responding. Try refreshing the page. Details: ${messageError.message}`);
      }
      
      console.log('Content script response:', response);
      
      if (response && response.success) {
        currentAnalysisData = response.data;
        updateSummary(currentAnalysisData);
        renderResults(currentAnalysisData);
        
        // Enable download button
        downloadBtn.disabled = false;
        
        const message = currentAnalysisData.summary.issuesFound > 0 
          ? `Found ${currentAnalysisData.summary.issuesFound} potential issues in ${currentAnalysisData.summary.totalFields} fields`
          : `✅ Analyzed ${currentAnalysisData.summary.totalFields} fields successfully`;
        
        showStatus(message, currentAnalysisData.summary.issuesFound > 0 ? 'warning' : 'success');
      } else if (response && response.error) {
        throw new Error(`Content script error: ${response.error}`);
      } else if (!response) {
        throw new Error('No response from content script. Please refresh the page and try again.');
      } else {
        throw new Error(`Unexpected response format: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      console.error('Analysis error:', error);
      showStatus(`❌ Analysis failed: ${error.message}`, 'error');
      resultsDiv.innerHTML = `<div class="no-results">Error: ${error.message}</div>`;
      currentAnalysisData = null;
      downloadBtn.disabled = true;
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Fields';
    }
  }

  // Clear results
  function clearResults() {
    currentAnalysisData = null;
    summaryDiv.style.display = 'none';
    resultsDiv.innerHTML = '<div class="no-results">Click "Analyze Fields" to check form fields</div>';
    statusDiv.style.display = 'none';
    downloadBtn.disabled = true;
  }

  // Event listeners
  analyzeBtn.addEventListener('click', analyzeFields);
  downloadBtn.addEventListener('click', downloadAnalysisData);
  clearBtn.addEventListener('click', clearResults);

  // Auto-analyze when popup opens
  analyzeFields();
}); 