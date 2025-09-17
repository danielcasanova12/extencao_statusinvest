// Salva as opções no chrome.storage
function save_options() {
  const apiBaseUrl = document.getElementById('apiBaseUrl').value;
  const apiToken = document.getElementById('apiToken').value;
  const exclusionList = document.getElementById('exclusionList').value;
  const minLiquidity = document.getElementById('minLiquidity').value;

  chrome.storage.sync.set({
    API_BASE_URL: apiBaseUrl,
    API_TOKEN: apiToken,
    POPUP_EXCLUSION_LIST: exclusionList,
    POPUP_MIN_LIQUIDITY: minLiquidity
  }, function() {
    // Exibe uma mensagem de que as opções foram salvas.
    const status = document.getElementById('status');
    status.textContent = 'Opções salvas.';
    status.style.display = 'block';
    setTimeout(function() {
      status.textContent = '';
      status.style.display = 'none';
    }, 1500);
  });
}

// Restaura o estado dos campos do formulário usando as preferências
// armazenadas no chrome.storage.
function restore_options() {
  // Usa valores padrão se não houver nada salvo
  chrome.storage.sync.get({
    API_BASE_URL: '',
    API_TOKEN: '',
    POPUP_EXCLUSION_LIST: 'ITUB4,BPAC11,BBDC3,BBAS3,ITSA4,SANB11,B3SA3,BBSE3,CXSE3,PSSA3,MULT3,ALOS3,BPAN4,BNBR3,BRAP4,ABCB4,IGTA3,BRSR6,BMEB4,BAZA3,BSLI3,PLPL3,BEES3,BMGB4,LOGG3,PINE4,WIZC3,BPAR3,SYNE3',
    POPUP_MIN_LIQUIDITY: '1000000'
  }, function(items) {
    document.getElementById('apiBaseUrl').value = items.API_BASE_URL;
    document.getElementById('apiToken').value = items.API_TOKEN;
    document.getElementById('exclusionList').value = items.POPUP_EXCLUSION_LIST;
    document.getElementById('minLiquidity').value = items.POPUP_MIN_LIQUIDITY;
  });
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);