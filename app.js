(function(){
  "use strict";

  /* ================= Static data ================= */
  var ROSTER = JSON.parse(document.getElementById('roster-data').textContent);
  var NOTES = JSON.parse(document.getElementById('notes-data').textContent);
  var LOGOS = JSON.parse(document.getElementById('logos-data').textContent);
  ROSTER.sort(function(a,b){ return a.semester - b.semester || a.name.localeCompare(b.name); });

  var TEAMS = [
    { id: 'HEYARS',   name: 'Heyars',    color: 'var(--t-heyars)',  logo: LOGOS.HEYARS  },
    { id: 'ZENITHX',  name: 'Zenith X',  color: 'var(--t-zenith)',  logo: LOGOS.ZENITHX },
    { id: 'HOYSALA',  name: 'Hoysala',   color: 'var(--t-hoysala)', logo: LOGOS.HOYSALA },
    { id: 'PHOENIX',  name: 'Phoenix',   color: 'var(--t-phoenix)', logo: LOGOS.PHOENIX },
  ];
  var STARTING_PURSE = 300;
  var BASE_BID = 5;

  var ROLE_PINS = { ADMIN: '9999', HEYARS: '1111', ZENITHX: '2222', HOYSALA: '3333', PHOENIX: '4444' };
  var ROLE_LABELS = { ADMIN: 'Admin', HEYARS: 'Heyars', ZENITHX: 'Zenith X', HOYSALA: 'Hoysala', PHOENIX: 'Phoenix', VIEWER: 'Viewing only' };

  var SPORT_ORDER = [
    "Kabaddi (Men's)", "Volleyball (Men's)", "Mini Cricket (Men's)",
    "Throw Ball (Women's)", "Tug of War (Men's & Women's)", "Shuttle Badminton (Men's & Women's)",
  ];
  var SPORT_SHORT = {
    "Kabaddi (Men's)":"Kabaddi", "Volleyball (Men's)":"Volleyball", "Mini Cricket (Men's)":"Mini Cricket",
    "Throw Ball (Women's)":"Throw Ball", "Tug of War (Men's & Women's)":"Tug of War",
    "Shuttle Badminton (Men's & Women's)":"Badminton",
  };
  var VERIFY_TEXT = {
    weak: "Matched to the roster by partial name similarity — confirm identity before finalising selection.",
    review: "The photo filename and the registered name/USN don't line up. Needs manual verification.",
    "nickname-guess": "No exact filename match; matched via a likely nickname. Please confirm.",
    none: "No matching photograph was found in the uploaded folder for this player."
  };

  function teamById(id){ for(var i=0;i<TEAMS.length;i++) if(TEAMS[i].id===id) return TEAMS[i]; return null; }
  function initials(name){ return name.split(' ').filter(Boolean).slice(0,2).map(function(w){return w[0];}).join('').toUpperCase(); }
  function teamLogoHtml(t){ return t && t.logo ? '<div class="team-logo"><img src="'+t.logo+'" alt="'+t.name+' logo"></div>' : ''; }

  /* ================= Role / access ================= */
  var ROLE_KEY = 'rqc_role_v1';
  var currentRole = null; // 'ADMIN' | 'HEYARS' | ... | 'VIEWER'
  function loadRole(){
    try { var v = localStorage.getItem(ROLE_KEY); return v || null; } catch(e){ return null; }
  }
  function saveRole(role){
    try { localStorage.setItem(ROLE_KEY, role); } catch(e){}
  }
  function clearRole(){
    try { localStorage.removeItem(ROLE_KEY); } catch(e){}
    currentRole = null;
    showRoleGate();
  }
  function isAdmin(){ return currentRole === 'ADMIN'; }
  function myTeamId(){ return (currentRole && currentRole !== 'ADMIN' && currentRole !== 'VIEWER') ? currentRole : null; }

  function renderRolePill(){
    var pill = document.getElementById('rolePill');
    var t = teamById(currentRole);
    var logo = t ? teamLogoHtml(t) : '';
    var label = ROLE_LABELS[currentRole] || 'Viewing only';
    pill.innerHTML = logo + '<span>'+label+'</span><button id="switchRoleBtn">switch</button>';
    document.getElementById('switchRoleBtn').addEventListener('click', clearRole);
  }

  function showRoleGate(){
    var overlay = document.getElementById('roleOverlay');
    var list = document.getElementById('roleList');
    var pinRow = document.getElementById('rolePinRow');
    var pinInput = document.getElementById('rolePinInput');
    var errBox = document.getElementById('roleError');
    var selected = null;
    pinRow.classList.remove('show');
    errBox.classList.remove('show');
    pinInput.value = '';

    var options = [
      { id: 'ADMIN', label: 'Admin', logo: '' },
    ].concat(TEAMS.map(function(t){ return { id: t.id, label: t.name, logo: t.logo }; }))
     .concat([{ id: 'VIEWER', label: 'Just viewing', logo: '' }]);

    list.innerHTML = options.map(function(o){
      var logo = o.logo ? '<div class="team-logo">'+'<img src="'+o.logo+'" alt="">'+'</div>' : '';
      return '<button class="role-opt" data-role="'+o.id+'">'+logo+'<span class="rname">'+o.label+'</span></button>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('.role-opt'), function(btn){
      btn.addEventListener('click', function(){
        selected = btn.getAttribute('data-role');
        Array.prototype.forEach.call(list.querySelectorAll('.role-opt'), function(b){ b.classList.toggle('selected', b===btn); });
        errBox.classList.remove('show');
        if (selected === 'VIEWER'){
          finishRoleSelect(selected);
        } else {
          pinRow.classList.add('show');
          pinInput.value = '';
          pinInput.focus();
        }
      });
    });

    function tryConfirm(){
      if (!selected || selected === 'VIEWER') return;
      if (pinInput.value === ROLE_PINS[selected]){
        finishRoleSelect(selected);
      } else {
        errBox.classList.add('show');
      }
    }
    document.getElementById('roleConfirmBtn').onclick = tryConfirm;
    pinInput.onkeydown = function(e){ if (e.key === 'Enter') tryConfirm(); };

    function finishRoleSelect(role){
      currentRole = role;
      saveRole(role);
      overlay.hidden = true;
      renderRolePill();
      renderAll();
    }

    overlay.hidden = false;
  }

  function initRole(){
    var r = loadRole();
    if (r && (r === 'ADMIN' || r === 'VIEWER' || teamById(r))){
      currentRole = r;
      renderRolePill();
    } else {
      currentRole = 'VIEWER';
      renderRolePill();
      showRoleGate();
    }
  }

  /* ================= Live state (db capability) ================= */
  var db = null;
  var sales = {};       // usn -> {team, price, ts}
  var stageMeta = { index: 0, bidAmount: BASE_BID, bidTeam: null };
  var localOnly = false;
  var unsubs = [];

  function setSyncStatus(text, offline){
    var pill = document.getElementById('syncPill');
    document.getElementById('syncText').textContent = text;
    pill.classList.toggle('offline', !!offline);
  }

  function initDb(){
    if (!window.claude || !window.claude.use){ localOnly = true; setSyncStatus('Local only — no live sync', true); renderAll(); return; }
    window.claude.use('db').then(function(handle){
      if (!handle){ localOnly = true; setSyncStatus('Local only — no live sync', true); renderAll(); return; }
      db = handle;
      setSyncStatus('Live — synced');
      unsubs.push(db.collection('sales').onSnapshot(function(snap){
        var next = {};
        snap.docs.forEach(function(d){ next[d.id] = d.data(); });
        sales = next;
        renderAll();
      }, function(err){ setSyncStatus('Sync error: '+(err&&err.code||'unknown'), true); }));
      unsubs.push(db.doc('meta/stage').onSnapshot(function(snap){
        if (snap.exists){
          var d = snap.data();
          stageMeta.index = typeof d.index === 'number' ? d.index : 0;
          stageMeta.bidAmount = typeof d.bidAmount === 'number' ? d.bidAmount : BASE_BID;
          stageMeta.bidTeam = d.bidTeam || null;
        }
        renderStage();
      }, function(err){ setSyncStatus('Sync error: '+(err&&err.code||'unknown'), true); }));
    }).catch(function(){ localOnly = true; setSyncStatus('Local only — no live sync', true); renderAll(); });
  }

  function writeStage(patch){
    Object.keys(patch).forEach(function(k){ stageMeta[k] = patch[k]; });
    if (db && !localOnly){ db.doc('meta/stage').set(stageMeta).catch(function(){}); }
    renderStage();
  }
  function sellCurrent(usn, team, price){
    sales[usn] = { team: team, price: price, ts: Date.now() };
    if (db && !localOnly){ db.doc('sales/'+usn).set(sales[usn]).catch(function(){}); }
    renderAll();
  }
  function undoSale(usn){
    delete sales[usn];
    if (db && !localOnly){ db.doc('sales/'+usn).delete().catch(function(){}); }
    renderAll();
  }

  /* ================= Team purse math ================= */
  function teamSpent(teamId){
    var spent = 0;
    Object.keys(sales).forEach(function(usn){ if (sales[usn].team === teamId) spent += sales[usn].price; });
    return spent;
  }
  function teamRemaining(teamId){ return STARTING_PURSE - teamSpent(teamId); }
  function teamPlayers(teamId){
    var list = [];
    Object.keys(sales).forEach(function(usn){
      if (sales[usn].team === teamId){
        var p = ROSTER.find(function(r){ return r.usn === usn; });
        if (p) list.push({ player: p, price: sales[usn].price });
      }
    });
    list.sort(function(a,b){ return b.price - a.price; });
    return list;
  }

  /* ================= Data layer (roster query) ================= */
  var Store = {
    all: ROSTER,
    byUsn: function(usn){ for (var i=0;i<this.all.length;i++){ if(this.all[i].usn===usn) return this.all[i]; } return null; },
    semesters: function(){ var s={}; this.all.forEach(function(p){ s[p.semester]=true; }); return Object.keys(s).map(Number).sort(function(a,b){return a-b;}); },
    sportList: function(){ var set = {}; this.all.forEach(function(p){ p.sports.forEach(function(s){ set[s.sport]=true; }); }); return Object.keys(set); },
    query: function(term, sem, sport){
      term = (term||'').trim().toLowerCase();
      return this.all.filter(function(p){
        var matchesTerm = !term || p.name.toLowerCase().indexOf(term)>-1 || p.usn.toLowerCase().indexOf(term)>-1;
        var matchesSem = (sem === 'ALL') || (String(p.semester) === String(sem));
        var matchesSport;
        if (sport === 'ALL') matchesSport = true;
        else if (sport === 'FLAG') matchesSport = p.match_status !== 'ok' || !p.usn_valid;
        else if (sport === 'UNSOLD') matchesSport = !sales[p.usn];
        else if (sport === 'SOLD') matchesSport = !!sales[p.usn];
        else matchesSport = p.sports.some(function(s){ return s.sport===sport; });
        return matchesTerm && matchesSem && matchesSport;
      });
    }
  };

  /* ================= Tabs ================= */
  var activeTab = 'roster';
  document.querySelectorAll('.tabbtn').forEach(function(btn){
    btn.addEventListener('click', function(){
      activeTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tabbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
      ['roster','stage','teams','summary','presenter'].forEach(function(t){
        document.getElementById('view-'+t).hidden = (t !== activeTab);
      });
      if (activeTab === 'stage') renderStage();
      if (activeTab === 'teams') renderTeams();
      if (activeTab === 'summary') renderSummary();
      if (activeTab === 'presenter') renderPresenter();
    });
  });

  /* ================= Header stats ================= */
  function renderStats(){
    var total = Store.all.length;
    var soldCount = Object.keys(sales).length;
    var flagged = Store.all.filter(function(p){ return p.match_status!=='ok' || !p.usn_valid; }).length;
    document.getElementById('statRow').innerHTML =
      '<div class="stat"><div class="n mono">'+total+'</div><div class="l">Players</div></div>'+
      '<div class="stat"><div class="n mono">'+soldCount+'/'+total+'</div><div class="l">Sold</div></div>'+
      '<div class="stat"><div class="n mono">'+flagged+'</div><div class="l">To verify</div></div>';
    document.getElementById('verifyFooterNote').textContent = flagged
      ? flagged + ' entries need manual verification (see the ⚠ filter).' : '';
  }

  /* ================= Data quality panel ================= */
  function renderDQ(){
    var missing = NOTES.missing_photo || {};
    var orphan = NOTES.orphan_photos || {};
    var badUsn = NOTES.bad_usn || [];
    var html = '';
    html += '<p><b>No photo found</b> — the uploaded folder had no matching image for these registrants:</p><ul>';
    Object.keys(missing).sort().forEach(function(sem){
      missing[sem].forEach(function(pair){ html += '<li>Sem '+sem+': '+pair[0]+' ('+pair[1]+')</li>'; });
    });
    html += '</ul>';
    html += '<p><b>Malformed USN</b> — likely typos in the registration form itself:</p><ul>';
    badUsn.forEach(function(b){ html += '<li>Sem '+b[2]+': '+b[0]+' — entered USN "'+b[1]+'"</li>'; });
    html += '</ul>';
    html += '<p><b>Unmatched photos</b> — uploaded photos with no corresponding form entry (possibly a missed submission):</p><ul>';
    Object.keys(orphan).sort().forEach(function(sem){
      orphan[sem].forEach(function(n){ html += '<li>Sem '+sem+': "'+n+'"</li>'; });
    });
    html += '</ul>';
    document.getElementById('dqBody').innerHTML = html;
  }

  /* ================= Roster: filter chips ================= */
  var currentSem = 'ALL', currentSport = 'ALL';
  function renderFilters(){
    var sems = Store.semesters();
    var semWrap = document.getElementById('semFilters');
    semWrap.innerHTML = ['ALL'].concat(sems).map(function(s){
      var label = s==='ALL' ? 'All semesters' : 'Sem '+s;
      return '<button class="chip'+(String(s)===String(currentSem)?' active':'')+'" data-sem="'+s+'">'+label+'</button>';
    }).join('');
    Array.prototype.forEach.call(semWrap.querySelectorAll('.chip'), function(btn){
      btn.addEventListener('click', function(){ currentSem = btn.getAttribute('data-sem'); renderFilters(); renderGrid(); });
    });

    var sports = Store.sportList();
    var wrap = document.getElementById('sportFilters');
    var chips = ['ALL'].concat(sports).concat(['UNSOLD','SOLD','FLAG']);
    wrap.innerHTML = chips.map(function(s){
      var label = s==='ALL' ? 'All events' : s==='UNSOLD' ? 'Unsold' : s==='SOLD' ? 'Sold' : s==='FLAG' ? '⚠ Needs verify' : SPORT_SHORT[s]||s;
      var cls = 'chip' + (s==='FLAG' ? ' flagged' : '') + (s==='SOLD' ? ' sold-chip' : '') + (s===currentSport ? ' active' : '');
      return '<button class="'+cls+'" data-sport="'+s+'">'+label+'</button>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('.chip'), function(btn){
      btn.addEventListener('click', function(){ currentSport = btn.getAttribute('data-sport'); renderFilters(); renderGrid(); });
    });
  }

  /* ================= Roster: grid ================= */
  function cardHtml(p){
    var photo = p.photo ? '<img src="'+p.photo+'" alt="Photo of '+p.name+'" loading="lazy">' : '<div class="no-photo">'+initials(p.name)+'</div>';
    var flag = (p.match_status!=='ok' || !p.usn_valid) ? '<div class="flag" title="Needs verification">!</div>' : '';
    var sale = sales[p.usn];
    var soldRibbon = '', soldClass = '';
    if (sale){
      var t = teamById(sale.team);
      soldClass = ' is-sold';
      soldRibbon = '<div class="sold-ribbon" style="background:'+(t?t.color:'#333')+'">SOLD · '+(t?t.name:sale.team)+' · '+sale.price+'pt</div>';
    }
    var dots = ''; for(var i=1;i<=6;i++){ dots += '<span class="dot'+(i<=p.sport_count?' on':'')+'"></span>'; }
    return (
      '<button class="card'+soldClass+'" data-usn="'+p.usn+'">'+
        '<div class="photo-wrap">'+photo+'<div class="sem-tag">SEM '+p.semester+'</div>'+flag+soldRibbon+'</div>'+
        '<div class="body">'+
          '<div class="name">'+p.name+'</div>'+
          '<div class="usn mono">'+p.usn+'</div>'+
          '<div class="sportbar"><div class="sportcount"><b>'+p.sport_count+'</b> event'+(p.sport_count===1?'':'s')+'</div><div class="dots">'+dots+'</div></div>'+
        '</div>'+
      '</button>'
    );
  }
  function renderGrid(){
    var term = document.getElementById('searchInput').value;
    var results = Store.query(term, currentSem, currentSport);
    var grid = document.getElementById('grid');
    var empty = document.getElementById('emptyState');
    document.getElementById('countNote').textContent = results.length + ' of ' + Store.all.length + ' players shown';
    if (!results.length){ grid.innerHTML=''; empty.hidden=false; return; }
    empty.hidden = true;
    grid.innerHTML = results.map(cardHtml).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('.card'), function(btn){
      btn.addEventListener('click', function(){ openDetail(btn.getAttribute('data-usn')); });
    });
  }

  /* ================= Roster: detail modal ================= */
  function sheetHtml(p){
    var photo = p.photo ? '<img src="'+p.photo+'" alt="Photo of '+p.name+'">' : '<div class="no-photo">'+initials(p.name)+'</div>';
    var verify = (p.match_status!=='ok') ? '<div class="verify-note">⚠ '+(VERIFY_TEXT[p.match_status]||'Needs verification.')+'</div>' : '';
    var usnNote = !p.usn_valid ? '<div class="verify-note">⚠ USN "'+p.usn+'" looks malformed on the original form — confirm the real USN with the player.</div>' : '';
    var rows = p.sports.map(function(s){
      var segs=''; for(var i=1;i<=5;i++){ segs += '<span class="seg'+(i<=s.rating?' on':'')+'"></span>'; }
      return '<div class="event-row"><div class="event-name">'+(SPORT_SHORT[s.sport]||s.sport)+'</div><div class="meter">'+segs+'</div><div class="rating-num mono">'+s.rating+'</div></div>';
    }).join('') || '<div class="event-row"><div class="event-name">No self-ratings submitted</div></div>';
    var avg = p.sports.length ? (p.sports.reduce(function(a,s){return a+s.rating;},0)/p.sports.length).toFixed(1) : '—';
    var top = p.sports.length ? p.sports.slice().sort(function(a,b){return b.rating-a.rating;})[0] : null;
    var sale = sales[p.usn];
    var soldBanner = '';
    if (sale){
      var t = teamById(sale.team);
      soldBanner = '<div class="sold-banner" style="background:'+(t?t.color:'#333')+'"><span>SOLD to '+(t?t.name:sale.team)+'</span><span class="mono">'+sale.price+' pts</span></div>';
    }
    var goStageBtn = isAdmin() ? '<div style="margin-top:16px;"><button class="btn" id="goStageBtn">Open on Auction Stage</button></div>' : '';
    return (
      '<div class="sheet-head">'+
        '<div class="sheet-photo">'+photo+'</div>'+
        '<div class="sheet-id">'+
          '<div class="name">'+p.name+'</div>'+
          '<div class="usn">'+p.usn+'</div>'+
          '<div class="badges"><span class="badge sem">Semester '+p.semester+'</span><span class="badge gender">'+p.gender+'</span>'+
            (p.match_status!=='ok' || !p.usn_valid ? '<span class="badge verify">⚠ Verify</span>' : '')+
          '</div>'+
        '</div>'+
        '<button class="close-btn" id="closeSheet" aria-label="Close">✕</button>'+
      '</div>'+
      '<div class="sheet-body">'+
        verify + usnNote +
        '<div class="section-label">Event picks &amp; self-rating (out of 5)</div>'+
        rows+
        '<div class="summary-strip">'+
          '<div class="item"><div class="n mono">'+p.sport_count+'</div><div class="l">Events</div></div>'+
          '<div class="item"><div class="n mono">'+avg+'</div><div class="l">Avg rating</div></div>'+
          (top ? '<div class="item"><div class="n" style="font-size:14px;font-family:Sora;font-weight:600;line-height:1.6;">'+(SPORT_SHORT[top.sport]||top.sport)+'</div><div class="l">Strongest pick</div></div>' : '')+
        '</div>'+
        soldBanner+
        goStageBtn+
      '</div>'
    );
  }
  function openDetail(usn){
    var p = Store.byUsn(usn);
    if(!p) return;
    document.getElementById('sheet').innerHTML = sheetHtml(p);
    document.getElementById('overlay').hidden = false;
    document.getElementById('closeSheet').addEventListener('click', closeDetail);
    var goBtn = document.getElementById('goStageBtn');
    if (goBtn) goBtn.addEventListener('click', function(){
      var idx = ROSTER.findIndex(function(r){ return r.usn === usn; });
      if (idx>-1){ writeStage({ index: idx, bidAmount: BASE_BID, bidTeam: null }); }
      closeDetail();
      document.querySelector('.tabbtn[data-tab="stage"]').click();
    });
  }
  function closeDetail(){ document.getElementById('overlay').hidden = true; }
  document.getElementById('overlay').addEventListener('click', function(e){ if (e.target.id === 'overlay') closeDetail(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeDetail(); });

  /* ================= Stage view (auction, with bidding) ================= */
  function currentStagePlayer(){
    var idx = Math.max(0, Math.min(ROSTER.length-1, stageMeta.index||0));
    return ROSTER[idx];
  }
  function goto(delta){
    var idx = Math.max(0, Math.min(ROSTER.length-1, (stageMeta.index||0)+delta));
    writeStage({ index: idx, bidAmount: BASE_BID, bidTeam: null });
  }
  function gotoNextUnsold(){
    var idx = stageMeta.index||0;
    for (var i=idx+1; i<ROSTER.length; i++){
      if (!sales[ROSTER[i].usn]){ writeStage({ index: i, bidAmount: BASE_BID, bidTeam: null }); return; }
    }
    for (var j=0; j<=idx; j++){
      if (!sales[ROSTER[j].usn]){ writeStage({ index: j, bidAmount: BASE_BID, bidTeam: null }); return; }
    }
  }
  document.getElementById('btnPrev').addEventListener('click', function(){ if (isAdmin()) goto(-1); });
  document.getElementById('btnNext').addEventListener('click', function(){ if (isAdmin()) goto(1); });
  document.getElementById('btnNextUnsold').addEventListener('click', function(){ if (isAdmin()) gotoNextUnsold(); });
  document.addEventListener('keydown', function(e){
    if (activeTab !== 'stage' || !isAdmin()) return;
    if (document.getElementById('overlay').hidden === false) return;
    if (e.key === 'ArrowRight') goto(1);
    if (e.key === 'ArrowLeft') goto(-1);
  });

  function renderStage(){
    if (activeTab !== 'stage') { renderStats(); return; }
    var p = currentStagePlayer();
    if (!p) return;
    document.getElementById('stageProgress').textContent =
      'Player ' + ((stageMeta.index||0)+1) + ' of ' + ROSTER.length + ' · Sem ' + p.semester;
    var navBtns = document.querySelectorAll('.stage-navbtns .btn');
    Array.prototype.forEach.call(navBtns, function(b){ b.disabled = !isAdmin(); b.style.opacity = isAdmin() ? '1' : '.4'; });

    var photo = p.photo ? '<img src="'+p.photo+'" alt="Photo of '+p.name+'">' : '<div class="no-photo">'+initials(p.name)+'</div>';
    var flagBadge = (p.match_status!=='ok' || !p.usn_valid) ? '<span class="badge verify">⚠ Verify match</span>' : '';
    var eventsHtml = p.sports.map(function(s){
      var segs=''; for(var i=1;i<=5;i++){ segs += '<span class="seg'+(i<=s.rating?' on':'')+'"></span>'; }
      return '<div class="event-row"><div class="event-name">'+(SPORT_SHORT[s.sport]||s.sport)+'</div><div class="meter">'+segs+'</div><div class="rating-num mono">'+s.rating+'</div></div>';
    }).join('') || '<div class="event-row"><div class="event-name">No self-ratings submitted</div></div>';

    var sale = sales[p.usn];
    var bottomHtml;
    var admin = isAdmin();
    var myTeam = myTeamId();

    if (sale){
      var t = teamById(sale.team);
      var undoBtn = admin ? '<button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.5)" id="undoSaleBtn">Undo sale</button>' : '';
      bottomHtml = '<div class="stage-sold-banner" style="background:'+(t?t.color:'#333')+'">'+
        '<div style="display:flex;align-items:center;gap:10px;">'+teamLogoHtml(t)+'<div class="big">SOLD to '+(t?t.name:sale.team)+'</div></div>'+
        '<div class="price mono">'+sale.price+' pts</div>'+
        undoBtn+
      '</div>';
    } else {
      var amt = stageMeta.bidAmount || BASE_BID;
      var leadTeam = stageMeta.bidTeam;
      var teamButtons = TEAMS.map(function(t){
        var rem = teamRemaining(t.id);
        var disabled = !admin || rem < amt;
        return '<button class="team-btn'+(leadTeam===t.id?' selected':'')+'" data-team="'+t.id+'" '+(disabled?'disabled':'')+' style="'+(leadTeam===t.id?('border-color:'+t.color):'')+'">'+
          '<div class="tb-head">'+teamLogoHtml(t)+'<span class="tname" style="color:'+t.color+'">'+t.name+'</span></div>'+
          '<span class="tpurse mono">'+rem+' pts left</span>'+
        '</button>';
      }).join('');

      var controlsHtml, quickHtml, sellRowHtml;
      if (admin){
        quickHtml = '<div class="quickbids"><button data-add="2">+2</button><button data-add="3">+3</button><button data-add="5">+5</button></div>';
        sellRowHtml = '<div class="sell-row">'+
            '<button class="btn primary" id="sellBtn" '+(leadTeam?'':'disabled')+'>Sell'+(leadTeam?(' to '+teamById(leadTeam).name):'')+' for '+amt+' pts</button>'+
            '<button class="btn" id="skipBtn">Skip / no bid</button>'+
          '</div>';
        controlsHtml =
          '<div class="bid-amount-row">'+
            '<button class="stepbtn" id="bidMinus">&minus;</button>'+
            '<div class="bid-amount mono">'+amt+'<span class="u">pts</span></div>'+
            '<button class="stepbtn" id="bidPlus">+</button>'+
          '</div>'+ quickHtml;
      } else if (myTeam){
        var myRemaining = teamRemaining(myTeam);
        var iAmLeading = leadTeam === myTeam;
        var bidIncs = [1,2,3,5];
        var teambidBtns = bidIncs.map(function(inc){
          var would = amt + inc;
          var dis = myRemaining < would;
          return '<button data-teambid="'+inc+'" '+(dis?'disabled':'')+'>Bid +'+inc+'</button>';
        }).join('');
        controlsHtml =
          '<div class="bid-amount-row">'+
            '<div class="bid-amount mono">'+amt+'<span class="u">pts'+(leadTeam?(' · leading: '+(teamById(leadTeam)?teamById(leadTeam).name:'')):'')+'</span></div>'+
          '</div>'+
          '<div class="quickbids">'+teambidBtns+'</div>';
        sellRowHtml = iAmLeading
          ? '<div class="readonly-note">You\'re leading at '+amt+' pts — the auctioneer confirms the final sale.</div>'
          : '<div class="readonly-note">Your bid raises the price live for everyone — the auctioneer confirms the final sale.</div>';
      } else {
        controlsHtml = '<div class="bid-amount-row"><div class="bid-amount mono">'+amt+'<span class="u">pts</span></div></div>';
        sellRowHtml = '<div class="readonly-note">Viewing only — bidding is done by each team or the auctioneer.</div>';
      }

      bottomHtml =
        '<div class="bid-panel">'+
          controlsHtml+
          '<div class="team-row">'+teamButtons+'</div>'+
          sellRowHtml+
        '</div>';
    }

    document.getElementById('stageCard').innerHTML =
      '<div class="stage-top">'+
        '<div class="stage-photo">'+photo+'</div>'+
        '<div class="stage-info">'+
          '<div class="stage-name">'+p.name+'</div>'+
          '<div class="stage-usn">'+p.usn+' · '+p.gender+'</div>'+
          '<div class="stage-badges"><span class="badge sem">Semester '+p.semester+'</span>'+flagBadge+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="stage-events"><div class="section-label">Event picks &amp; self-rating</div><div class="grid2">'+eventsHtml+'</div></div>'+
      bottomHtml;

    if (!sale){
      if (admin){
        document.getElementById('bidMinus').addEventListener('click', function(){
          writeStage({ bidAmount: Math.max(BASE_BID, (stageMeta.bidAmount||BASE_BID)-1) });
        });
        document.getElementById('bidPlus').addEventListener('click', function(){
          writeStage({ bidAmount: (stageMeta.bidAmount||BASE_BID)+1 });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.quickbids button[data-add]'), function(btn){
          btn.addEventListener('click', function(){
            writeStage({ bidAmount: (stageMeta.bidAmount||BASE_BID) + parseInt(btn.getAttribute('data-add'),10) });
          });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.team-btn'), function(btn){
          if (btn.disabled) return;
          btn.addEventListener('click', function(){ writeStage({ bidTeam: btn.getAttribute('data-team') }); });
        });
        var sellBtn = document.getElementById('sellBtn');
        if (sellBtn) sellBtn.addEventListener('click', function(){
          if (!stageMeta.bidTeam) return;
          sellCurrent(p.usn, stageMeta.bidTeam, stageMeta.bidAmount||BASE_BID);
          setTimeout(gotoNextUnsold, 250);
        });
        var skipBtn = document.getElementById('skipBtn');
        if (skipBtn) skipBtn.addEventListener('click', function(){ goto(1); });
      } else if (myTeam){
        Array.prototype.forEach.call(document.querySelectorAll('.quickbids button[data-teambid]'), function(btn){
          btn.addEventListener('click', function(){
            var inc = parseInt(btn.getAttribute('data-teambid'),10);
            var newAmt = (stageMeta.bidAmount||BASE_BID) + inc;
            if (teamRemaining(myTeam) < newAmt) return;
            writeStage({ bidAmount: newAmt, bidTeam: myTeam });
          });
        });
      }
    } else {
      var undoBtn2 = document.getElementById('undoSaleBtn');
      if (undoBtn2) undoBtn2.addEventListener('click', function(){ undoSale(p.usn); });
    }
  }

  /* ================= Teams view ================= */
  function renderTeams(){
    var totalSold = Object.keys(sales).length;
    var totalSpent = 0; TEAMS.forEach(function(t){ totalSpent += teamSpent(t.id); });
    document.getElementById('teamsSummary').innerHTML =
      '<div class="stat"><div class="n mono">'+totalSold+'/'+ROSTER.length+'</div><div class="l">Players sold</div></div>'+
      '<div class="stat"><div class="n mono">'+totalSpent+'</div><div class="l">Total points spent</div></div>';

    var admin = isAdmin();
    document.getElementById('teamsGrid').innerHTML = TEAMS.map(function(t){
      var players = teamPlayers(t.id);
      var remaining = teamRemaining(t.id);
      var rows = players.length ? players.map(function(x){
        var photo = x.player.photo ? '<img src="'+x.player.photo+'" alt="">' : '<div class="ph">'+initials(x.player.name)+'</div>';
        var undoBtn = admin ? '<button data-usn="'+x.player.usn+'" title="Undo">✕</button>' : '';
        return '<div class="team-player-row">'+photo+
          '<div class="tpn">'+x.player.name+'<div style="color:var(--muted);font-size:10.5px;">Sem '+x.player.semester+' · '+x.player.usn+'</div></div>'+
          '<div class="tpp mono">'+x.price+' pt</div>'+
          undoBtn+
        '</div>';
      }).join('') : '<div class="empty-team">No players bought yet.</div>';
      return '<div class="team-card" style="--tc:'+t.color+'">'+
        '<div class="tc-head">'+teamLogoHtml(t)+'<h3 style="color:'+t.color+'">'+t.name+'</h3></div>'+
        '<div class="team-purse-row"><div><div class="n mono">'+remaining+'</div><div class="l">Purse remaining</div></div>'+
          '<div style="text-align:right"><div class="n mono">'+players.length+'</div><div class="l">Players</div></div></div>'+
        '<div class="team-players">'+rows+'</div>'+
      '</div>';
    }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('.team-player-row button'), function(btn){
      btn.addEventListener('click', function(){ undoSale(btn.getAttribute('data-usn')); });
    });
  }

  /* ================= Summary view (per-team image/USN/year, read-only) ================= */
  function summaryCardHtml(p, price){
    var photo = p.photo ? '<img src="'+p.photo+'" alt="Photo of '+p.name+'">' : '<div class="no-photo">'+initials(p.name)+'</div>';
    return '<div class="summary-card">'+
      '<div class="sc-photo">'+photo+'</div>'+
      '<div class="sc-body">'+
        '<div class="sc-name">'+p.name+'</div>'+
        '<div class="sc-meta">'+p.usn+'</div>'+
        '<div class="sc-meta">Sem '+p.semester+(price!=null?' · '+price+' pt':'')+'</div>'+
      '</div>'+
    '</div>';
  }
  function renderSummary(){
    document.getElementById('summaryGrid').innerHTML = TEAMS.map(function(t){
      var players = teamPlayers(t.id);
      var cards = players.length
        ? players.map(function(x){ return summaryCardHtml(x.player, x.price); }).join('')
        : '<div class="empty-team">No players bought yet.</div>';
      return '<div class="summary-team" style="--tc:'+t.color+'">'+
        '<div class="summary-team-head">'+
          '<div style="display:flex;align-items:center;gap:10px;">'+teamLogoHtml(t)+'<h3 style="color:'+t.color+'">'+t.name+'</h3></div>'+
          '<div class="mono" style="font-size:12px;color:var(--muted);">'+players.length+' player'+(players.length===1?'':'s')+'</div>'+
        '</div>'+
        '<div class="summary-team-cards">'+cards+'</div>'+
      '</div>';
    }).join('');
  }

  /* ================= Export (customizable download, info-only or image+info) ================= */
  var EXPORT_FIELDS = [
    { key:'name',      label:'Name',                    always:true },
    { key:'usn',       label:'USN' },
    { key:'semester',  label:'Semester' },
    { key:'gender',    label:'Gender' },
    { key:'sport_count', label:'Number of events' },
    { key:'sports',    label:'Events & self-ratings' },
    { key:'match_status', label:'Match verification status' },
    { key:'sold_status', label:'Sold / Unsold' },
    { key:'team',      label:'Team (if sold)' },
    { key:'price',     label:'Sale price (if sold)' },
  ];
  var exportFieldState = {}; EXPORT_FIELDS.forEach(function(f){ exportFieldState[f.key] = true; });

  function exportScopeOptions(){
    var opts = [
      { value:'ALL', label:'All players ('+ROSTER.length+')' },
      { value:'CURRENT_FILTER', label:'Current Roster filter ('+Store.query(document.getElementById('searchInput').value, currentSem, currentSport).length+')' },
      { value:'SOLD', label:'All sold players' },
      { value:'UNSOLD', label:'All unsold players' },
    ];
    TEAMS.forEach(function(t){ opts.push({ value:'TEAM_'+t.id, label: t.name + ' squad' }); });
    return opts;
  }
  function playersForScope(scope){
    if (scope === 'ALL') return ROSTER.slice();
    if (scope === 'CURRENT_FILTER') return Store.query(document.getElementById('searchInput').value, currentSem, currentSport);
    if (scope === 'SOLD') return ROSTER.filter(function(p){ return !!sales[p.usn]; });
    if (scope === 'UNSOLD') return ROSTER.filter(function(p){ return !sales[p.usn]; });
    if (scope.indexOf('TEAM_') === 0){
      var tid = scope.slice(5);
      return ROSTER.filter(function(p){ return sales[p.usn] && sales[p.usn].team === tid; });
    }
    return ROSTER.slice();
  }
  function fieldValue(p, key){
    var sale = sales[p.usn];
    switch(key){
      case 'name': return p.name;
      case 'usn': return p.usn;
      case 'semester': return p.semester;
      case 'gender': return p.gender;
      case 'sport_count': return p.sport_count;
      case 'sports': return p.sports.map(function(s){ return (SPORT_SHORT[s.sport]||s.sport)+':'+s.rating; }).join('; ');
      case 'match_status': return (p.match_status==='ok' && p.usn_valid) ? 'OK' : (p.match_status || 'review');
      case 'sold_status': return sale ? 'SOLD' : 'UNSOLD';
      case 'team': return sale ? (teamById(sale.team)?teamById(sale.team).name:sale.team) : '';
      case 'price': return sale ? sale.price : '';
      default: return '';
    }
  }
  function csvEscape(v){
    v = (v===undefined||v===null) ? '' : String(v);
    if (/[",\n]/.test(v)) v = '"'+v.replace(/"/g,'""')+'"';
    return v;
  }
  function buildCsv(players, fields){
    var rows = [fields.map(function(f){ return csvEscape(f.label); }).join(',')];
    players.forEach(function(p){
      rows.push(fields.map(function(f){ return csvEscape(fieldValue(p, f.key)); }).join(','));
    });
    return rows.join('\r\n');
  }
  function buildImageHtml(players, fields){
    var rowsHtml = players.map(function(p){
      var photo = p.photo ? '<img src="'+p.photo+'" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#eee;font-weight:700;color:#888;">'+initials(p.name)+'</div>';
      var infoRows = fields.filter(function(f){ return f.key!=='name'; }).map(function(f){
        var v = fieldValue(p, f.key);
        if (v==='' || v==null) return '';
        return '<div style="font-size:12px;color:#555;margin-top:2px;"><b style="color:#222;">'+f.label+':</b> '+v+'</div>';
      }).join('');
      return '<div style="background:#fff;border:1px solid #ddd;border-radius:12px;overflow:hidden;break-inside:avoid;">'+
        '<div style="aspect-ratio:1/1;background:#eee;">'+photo+'</div>'+
        '<div style="padding:10px 12px;"><div style="font-weight:700;font-size:14.5px;">'+p.name+'</div>'+infoRows+'</div>'+
      '</div>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>Robic Quest Cup 2026 — Export</title>'+
      '<style>body{font-family:Arial,sans-serif;background:#f4f5f1;padding:24px;margin:0;}'+
      'h1{font-size:22px;margin:0 0 4px;}p.sub{color:#666;font-size:12.5px;margin:0 0 20px;}'+
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;}</style>'+
      '</head><body>'+
      '<h1>Robic Quest Cup 2026</h1><p class="sub">Exported '+new Date().toLocaleString()+' · '+players.length+' player'+(players.length===1?'':'s')+'</p>'+
      '<div class="grid">'+rowsHtml+'</div>'+
      '</body></html>';
  }
  var downloadsHandle = null;
  function initDownloads(){
    if (!window.claude || !window.claude.use){ return; }
    window.claude.use('downloads').then(function(h){ downloadsHandle = h; }).catch(function(){});
  }
  function setExportStatus(msg){
    var el = document.getElementById('exportCount');
    if (el) el.textContent = msg;
  }
  function buildPdf(players, fields){
    if (!window.jspdf || !window.jspdf.jsPDF || !window.autoTable){
      throw new Error('pdf_lib_unavailable');
    }
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('Robic Quest Cup 2026', 40, 32);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text('Exported ' + new Date().toLocaleString() + ' · ' + players.length + ' player' + (players.length===1?'':'s'), 40, 48);
    doc.setTextColor(0);

    var infoFields = fields.filter(function(f){ return f.key !== 'name'; });
    var head = [['Photo', 'Name'].concat(infoFields.map(function(f){ return f.label; }))];
    var body = players.map(function(p){
      return [''].concat([p.name]).concat(infoFields.map(function(f){
        var v = fieldValue(p, f.key);
        return (v===undefined||v===null) ? '' : String(v);
      }));
    });

    window.autoTable(doc, {
      startY: 62,
      head: head,
      body: body,
      styles: { fontSize: 8.5, cellPadding: 6, valign: 'middle', minCellHeight: 46, overflow: 'linebreak' },
      headStyles: { fillColor: [21, 24, 18], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 245, 241] },
      columnStyles: { 0: { cellWidth: 46 } },
      margin: { left: 40, right: 40 },
      rowPageBreak: 'avoid',
      didDrawCell: function(data){
        if (data.column.index === 0 && data.section === 'body'){
          var p = players[data.row.index];
          var pad = 4;
          var size = Math.min(data.cell.height, data.cell.width) - pad * 2;
          var x = data.cell.x + (data.cell.width - size) / 2;
          var y = data.cell.y + pad;
          if (p && p.photo){
            try { doc.addImage(p.photo, 'JPEG', x, y, size, size); } catch(e){ /* skip a photo jsPDF can't decode */ }
          }
        }
      }
    });

    return doc.output('blob');
  }

  function triggerDownload(filename, mime, content){
    if (!downloadsHandle){
      setExportStatus('Downloads aren\'t available in this view right now — try again in a moment.');
      return;
    }
    var blob = (content instanceof Blob) ? content : new Blob([content], { type: mime });
    downloadsHandle.save({ filename: filename, data: blob }).then(function(){
      setExportStatus('Saved ' + filename + '.');
    }).catch(function(err){
      var code = err && err.code;
      var msg = code === 'declined' ? 'Download cancelled.' :
        code === 'rejected_extension' ? 'That file type isn\'t supported for download here.' :
        'Couldn\'t save the file (' + (code||'unknown error') + ').';
      setExportStatus(msg);
    });
  }

  function renderExportFields(){
    document.getElementById('exportFields').innerHTML = EXPORT_FIELDS.map(function(f){
      var checked = exportFieldState[f.key] ? 'checked' : '';
      var dis = f.always ? 'disabled' : '';
      return '<label><input type="checkbox" data-field="'+f.key+'" '+checked+' '+dis+'><span>'+f.label+'</span></label>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#exportFields input[data-field]'), function(cb){
      cb.addEventListener('change', function(){ exportFieldState[cb.getAttribute('data-field')] = cb.checked; updateExportCount(); });
    });
  }
  function updateExportCount(){
    var scope = document.getElementById('exportScope').value;
    var n = playersForScope(scope).length;
    document.getElementById('exportCount').textContent = n + ' player' + (n===1?'':'s') + ' will be included.';
  }
  function openExport(defaultScope){
    var sel = document.getElementById('exportScope');
    sel.innerHTML = exportScopeOptions().map(function(o){ return '<option value="'+o.value+'">'+o.label+'</option>'; }).join('');
    if (defaultScope) sel.value = defaultScope;
    renderExportFields();
    updateExportCount();
    document.getElementById('exportOverlay').hidden = false;
  }
  function closeExport(){ document.getElementById('exportOverlay').hidden = true; }
  document.getElementById('exportBtn').addEventListener('click', function(){ openExport('ALL'); });
  document.getElementById('exportCloseBtn').addEventListener('click', closeExport);
  document.getElementById('exportCancelBtn').addEventListener('click', closeExport);
  document.getElementById('exportOverlay').addEventListener('click', function(e){ if (e.target.id === 'exportOverlay') closeExport(); });
  document.getElementById('exportScope').addEventListener('change', updateExportCount);
  document.getElementById('exportDownloadBtn').addEventListener('click', function(){
    var scope = document.getElementById('exportScope').value;
    var format = document.querySelector('input[name="exportFormat"]:checked').value;
    var players = playersForScope(scope);
    var fields = EXPORT_FIELDS.filter(function(f){ return exportFieldState[f.key]; });
    var stamp = new Date().toISOString().slice(0,10);
    setExportStatus('Preparing download…');
    if (format === 'info'){
      triggerDownload('rqc2026_export_'+stamp+'.csv', 'text/csv;charset=utf-8', buildCsv(players, fields));
    } else if (format === 'pdf'){
      try {
        var pdfBlob = buildPdf(players, fields);
        triggerDownload('rqc2026_export_'+stamp+'.pdf', 'application/pdf', pdfBlob);
      } catch(e){
        setExportStatus('PDF export isn\'t available right now — try the HTML or CSV option instead.');
      }
    } else {
      triggerDownload('rqc2026_export_'+stamp+'.html', 'text/html;charset=utf-8', buildImageHtml(players, fields));
    }
  });

  /* ================= Presenter view (fast, no bidding, any-semester switch) ================= */
  var presSem = 'ALL', presStatus = 'ALL';
  var presCurrentUsn = ROSTER.length ? ROSTER[0].usn : null;

  function presenterList(){
    return ROSTER.filter(function(p){
      var okSem = (presSem === 'ALL') || (String(p.semester) === String(presSem));
      var sale = sales[p.usn];
      var okStatus = (presStatus === 'ALL') || (presStatus === 'SOLD' && sale) || (presStatus === 'UNSOLD' && !sale);
      return okSem && okStatus;
    });
  }
  function renderPresenterFilters(){
    var sems = Store.semesters();
    var semWrap = document.getElementById('presSemFilters');
    semWrap.innerHTML = ['ALL'].concat(sems).map(function(s){
      var label = s==='ALL' ? 'All semesters' : 'Sem '+s;
      return '<button class="chip'+(String(s)===String(presSem)?' active':'')+'" data-psem="'+s+'">'+label+'</button>';
    }).join('');
    Array.prototype.forEach.call(semWrap.querySelectorAll('.chip'), function(btn){
      btn.addEventListener('click', function(){ presSem = btn.getAttribute('data-psem'); renderPresenterFilters(); ensurePresSelection(); renderPresenter(); });
    });
    var stWrap = document.getElementById('presStatusFilters');
    var stOpts = [ ['ALL','All'], ['SOLD','Sold'], ['UNSOLD','Unsold'] ];
    stWrap.innerHTML = stOpts.map(function(o){
      return '<button class="chip'+(o[0]===presStatus?' active':'')+'" data-pstatus="'+o[0]+'">'+o[1]+'</button>';
    }).join('');
    Array.prototype.forEach.call(stWrap.querySelectorAll('.chip'), function(btn){
      btn.addEventListener('click', function(){ presStatus = btn.getAttribute('data-pstatus'); renderPresenterFilters(); ensurePresSelection(); renderPresenter(); });
    });
  }
  function ensurePresSelection(){
    var list = presenterList();
    if (!list.length){ return; }
    if (!list.some(function(p){ return p.usn === presCurrentUsn; })){
      presCurrentUsn = list[0].usn;
    }
  }
  function presenterCardHtml(p){
    var photo = p.photo ? '<img src="'+p.photo+'" alt="Photo of '+p.name+'">' : '<div class="no-photo">'+initials(p.name)+'</div>';
    var eventsHtml = p.sports.map(function(s){
      var segs=''; for(var i=1;i<=5;i++){ segs += '<span class="seg'+(i<=s.rating?' on':'')+'"></span>'; }
      return '<div class="event-row"><div class="event-name">'+(SPORT_SHORT[s.sport]||s.sport)+'</div><div class="meter">'+segs+'</div><div class="rating-num mono">'+s.rating+'</div></div>';
    }).join('') || '<div class="event-row"><div class="event-name">No self-ratings submitted</div></div>';
    var sale = sales[p.usn];
    var statusHtml;
    if (sale){
      var t = teamById(sale.team);
      statusHtml = '<div class="p-sold-badge" style="background:'+(t?t.color:'#333')+'">'+teamLogoHtml(t)+'<span>SOLD · '+(t?t.name:sale.team)+' · '+sale.price+' pts</span></div>';
    } else {
      statusHtml = '<div class="p-unsold-badge">Unsold</div>';
    }
    return (
      '<div class="p-photo">'+photo+'</div>'+
      '<div class="p-info">'+
        '<div class="p-name">'+p.name+'</div>'+
        '<div class="p-usn">'+p.usn+' · '+p.gender+'</div>'+
        '<div class="p-badges"><span class="badge sem">Semester '+p.semester+'</span><span class="badge gender">'+p.sport_count+' event'+(p.sport_count===1?'':'s')+'</span></div>'+
        statusHtml+
        '<div class="p-events">'+eventsHtml+'</div>'+
      '</div>'
    );
  }
  function renderPresenter(){
    if (activeTab !== 'presenter') return;
    var list = presenterList();
    if (!list.length){
      document.getElementById('presProgress').textContent = 'No players match this filter';
      document.getElementById('presCard').innerHTML = '<div class="p-info"><div class="readonly-note">No players match the current semester/status filter.</div></div>';
      return;
    }
    ensurePresSelection();
    var idx = list.findIndex(function(p){ return p.usn === presCurrentUsn; });
    if (idx === -1){ idx = 0; presCurrentUsn = list[0].usn; }
    var p = list[idx];
    document.getElementById('presProgress').textContent = 'Player ' + (idx+1) + ' of ' + list.length + (presSem!=='ALL'||presStatus!=='ALL' ? ' (filtered)' : '');
    document.getElementById('presCard').innerHTML = presenterCardHtml(p);
  }
  function presenterGoto(delta){
    var list = presenterList();
    if (!list.length) return;
    var idx = list.findIndex(function(p){ return p.usn === presCurrentUsn; });
    if (idx === -1) idx = 0;
    idx = Math.max(0, Math.min(list.length-1, idx+delta));
    presCurrentUsn = list[idx].usn;
    renderPresenter();
  }
  document.getElementById('presPrev').addEventListener('click', function(){ presenterGoto(-1); });
  document.getElementById('presNext').addEventListener('click', function(){ presenterGoto(1); });

  function hidePresSuggest(){ document.getElementById('presSuggest').hidden = true; }
  document.getElementById('presJump').addEventListener('input', function(e){
    var term = e.target.value.trim().toLowerCase();
    var box = document.getElementById('presSuggest');
    if (!term){ box.hidden = true; return; }
    var matches = ROSTER.filter(function(p){ return p.name.toLowerCase().indexOf(term)>-1 || p.usn.toLowerCase().indexOf(term)>-1; }).slice(0, 12);
    if (!matches.length){ box.innerHTML = '<button disabled style="color:var(--muted);cursor:default;">No matches</button>'; box.hidden = false; return; }
    box.innerHTML = matches.map(function(p){
      return '<button data-usn="'+p.usn+'"><span>'+p.name+' <span class="ps-usn">Sem '+p.semester+'</span></span><span class="ps-usn">'+p.usn+(sales[p.usn]?' · SOLD':'')+'</span></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button[data-usn]'), function(btn){
      btn.addEventListener('click', function(){
        var usn = btn.getAttribute('data-usn');
        presSem = 'ALL'; presStatus = 'ALL'; renderPresenterFilters();
        presCurrentUsn = usn;
        document.getElementById('presJump').value = '';
        box.hidden = true;
        renderPresenter();
      });
    });
    box.hidden = false;
  });
  document.addEventListener('click', function(e){
    if (e.target.id !== 'presJump' && !document.getElementById('presSuggest').contains(e.target)) hidePresSuggest();
  });
  document.addEventListener('keydown', function(e){
    if (activeTab !== 'presenter') return;
    if (document.getElementById('overlay').hidden === false) return;
    if (document.activeElement && document.activeElement.id === 'presJump') return;
    if (e.key === 'ArrowRight' || e.key === ' '){ e.preventDefault(); presenterGoto(1); }
    if (e.key === 'ArrowLeft') presenterGoto(-1);
  });

  /* ================= Wire up & init ================= */
  document.getElementById('searchInput').addEventListener('input', renderGrid);

  function renderAll(){
    renderStats();
    renderGrid();
    if (activeTab==='stage') renderStage();
    if (activeTab==='teams') renderTeams();
    if (activeTab==='summary') renderSummary();
    if (activeTab==='presenter') renderPresenter();
  }

  renderDQ();
  renderFilters();
  renderPresenterFilters();
  initRole();
  renderAll();
  initDb();
  initDownloads();
})();
