'use strict';
(() => {
  const bridge=window.parent!==window?window.parent.PokeSiftRoomBridge:null;
  if(!bridge?.valid()){location.replace('/');return;}
  const data=bridge.open();
  window.POKESIFT_ROOM={...data,current:bridge.open,persist:bridge.saveLayout,openDetail:bridge.detail,focusRoom:bridge.focusRoom,notice:bridge.notice,ready:bridge.ready,retryArtwork:bridge.retryArtwork};
  document.body.dataset.theme=data.theme;document.body.classList.add('live-collection');
})();
