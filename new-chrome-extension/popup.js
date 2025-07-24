document.addEventListener('DOMContentLoaded', function() {
  // Load saved endpoint
  chrome.storage.local.get(['apiEndpoint'], function(result) {
    if (result.apiEndpoint) {
      document.getElementById('apiEndpointInput').value = result.apiEndpoint;
    }
  });

  // Restore summary from session storage if available
  const savedSummary = sessionStorage.getItem('lastSummary');
  if (savedSummary) {
    try {
      const summaryData = JSON.parse(savedSummary);
      // Only restore if it's less than 30 minutes old
      if (Date.now() - summaryData.timestamp < 30 * 60 * 1000) {
        displaySummary(summaryData.summary, summaryData.pagesProcessed);
      } else {
        // Clear old summary
        sessionStorage.removeItem('lastSummary');
      }
    } catch (e) {
      // Invalid data, clear it
      sessionStorage.removeItem('lastSummary');
    }
  }

  // Save endpoint
  document.getElementById('saveEndpointButton').addEventListener('click', function() {
    const endpoint = document.getElementById('apiEndpointInput').value.trim();
    if (endpoint) {
      chrome.storage.local.set({apiEndpoint: endpoint}, function() {
        showMessage('endpointStatus', 'Endpoint saved!', 'success');
      });
    } else {
      showMessage('endpointStatus', 'Please enter a valid endpoint', 'error');
    }
  });

  // Fill form button
  document.getElementById('fillFormButton').addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "downloadAndProcess"}, function(response) {
        if (chrome.runtime.lastError) {
          showMessage('status', 'Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          showMessage('status', response.message, 'success');
        } else {
          showMessage('status', response ? response.message : 'Unknown error', 'error');
        }
      });
    });
  });

  // Summarize PDF button
  document.getElementById('summarizeButton').addEventListener('click', function() {
    const button = document.getElementById('summarizeButton');
    const originalText = button.textContent;
    
    // Disable button and show loading state
    button.disabled = true;
    button.textContent = 'Summarizing...';
    showMessage('status', 'Summarizing PDF...', 'info');
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "summarizePdf"}, function(response) {
        // Re-enable button
        button.disabled = false;
        button.textContent = originalText;
        
        if (chrome.runtime.lastError) {
          showMessage('status', 'Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          const message = `Successfully summarized ${response.pagesProcessed || 'unknown'} pages`;
          showMessage('status', message, 'success');
          
          // Save to session storage for persistence
          sessionStorage.setItem('lastSummary', JSON.stringify({
            summary: response.summary,
            pagesProcessed: response.pagesProcessed,
            timestamp: Date.now()
          }));
          
          displaySummary(response.summary, response.pagesProcessed);
        } else {
          showMessage('status', response ? response.message : 'Unknown error', 'error');
        }
      });
    });
  });

  // Close summary button
  document.getElementById('closeSummaryButton').addEventListener('click', function() {
    document.getElementById('summarySection').style.display = 'none';
    // Restore original width when closing summary
    document.body.style.width = '300px';
  });

  // Copy to clipboard button
  document.getElementById('copyToClipboardButton').addEventListener('click', function() {
    const summaryContent = document.getElementById('summaryContent').textContent;
    if (summaryContent && summaryContent.trim()) {
      navigator.clipboard.writeText(summaryContent.trim()).then(function() {
        // Show success feedback
        const button = document.getElementById('copyToClipboardButton');
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.style.background = '#28a745';
        
        // Reset button after 2 seconds
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '';
        }, 2000);
        
        showMessage('status', 'Summary copied to clipboard!', 'success');
      }).catch(function(err) {
        console.error('Failed to copy to clipboard:', err);
        showMessage('status', 'Failed to copy to clipboard', 'error');
      });
    } else {
      showMessage('status', 'No summary to copy', 'error');
    }
  });

  function showMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.style.color = type === 'success' ? '#155724' : 
                         type === 'error' ? '#721c24' : '#856404';
    setTimeout(() => {
      element.textContent = '';
    }, 3000);
  }

  function displaySummary(summary, pagesProcessed) {
    const summaryContent = document.getElementById('summaryContent');
    const summarySection = document.getElementById('summarySection');
    
    // Clean and format the summary
    const cleanSummary = summary || 'No summary available.';
    
    // Add header with page count if available
    let displayText = cleanSummary;
    if (pagesProcessed) {
      displayText = `${cleanSummary}`;
    }
    
    summaryContent.textContent = displayText;
    
    // Expand popup width when showing summary
    document.body.style.width = '500px';
    
    // Show the summary section
    summarySection.style.display = 'block';
    
    // Scroll to top of summary
    summaryContent.scrollTop = 0;
    
    // Auto-scroll popup to show summary
    setTimeout(() => {
      summarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }
}); 