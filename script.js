(function(){
  "use strict";

  /* ============ Constants ============ */
  const FIXED_SECTIONS = [
    {key:"home", label:"Home"},
    {key:"achievements", label:"Achievements & Education"},
    {key:"projects", label:"Projects"},
    {key:"skills", label:"Skills"},
    {key:"experience", label:"Experience"},
    {key:"contact", label:"Contact"}
  ];
  const SOCIAL_TYPES = ["github","linkedin","twitter","instagram","email","website","youtube","behance","dribbble","other"];
  const PREFS_KEY = "portfolio_prefs_v1";

  /* ============ State ============ */
  let data = null;        // live portfolio content, backed by the server (Vercel Blob via /api/data)
  let authState = {hasPassword:false, authenticated:false};
  let prefs = {theme:"paper", size:"md"};
  let state = { editing:false, section:"home" };

  const page = document.getElementById("page");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  function uid(){ return "id_" + Math.random().toString(36).slice(2,10); }
  function esc(str){ return String(str==null?"":str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function nl2br(str){ return esc(str).replace(/\n/g,"<br>"); }
  function getInitials(name){
    if(!name || !name.trim()) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }

  /* ============ Reordering ============ */
  function moveInArray(arr, id, dir){
    if(!arr) return;
    const idx = arr.findIndex(x=>x.id===id);
    if(idx<0) return;
    const swapIdx = idx + dir;
    if(swapIdx<0 || swapIdx>=arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
  }
  function moveButtons(listKey, id, parentId, idx, length){
    const upDisabled = idx===0, downDisabled = idx===length-1;
    const parentAttr = parentId ? `data-parent-id="${esc(parentId)}"` : '';
    return `<button class="textlink" data-action="move-item" data-list="${listKey}" data-id="${id}" data-dir="up" ${parentAttr} ${upDisabled?'disabled style="opacity:.3;"':''} title="Move up">↑</button>
      <button class="textlink" data-action="move-item" data-list="${listKey}" data-id="${id}" data-dir="down" ${parentAttr} ${downDisabled?'disabled style="opacity:.3;"':''} title="Move down">↓</button>`;
  }

  /* ============ Certificate reveal (accordion) ============ */
  function renderCertTrigger(item){
    const hasFile = item.certFileUrl;
    if(!item.certLink && !item.certImage && !hasFile) return "";
    const fileDownloadAttr = hasFile && item.certFileUrl.startsWith("data:") ? `download="${esc(item.certFileLabel||'file')}"` : '';
    const linkRow = (item.certLink || hasFile) ? `<div class="cert-links">
        ${item.certLink?`<a class="cert-link" href="${esc(item.certLink)}" target="_blank" rel="noopener">Open link ↗</a>`:''}
        ${hasFile?`<a class="cert-link" href="${esc(item.certFileUrl)}" target="_blank" rel="noopener" ${fileDownloadAttr}>${esc(item.certFileLabel || "Download file")} ↓</a>`:''}
      </div>` : '';
    return `<button class="cert-trigger" data-action="toggle-cert" data-id="${item.id}">
      <span class="cert-trigger-label">Additional links</span>
      <span class="cert-chevron">⌄</span>
    </button>
    <div class="cert-box" id="certbox-${item.id}">
      <div class="cert-box-inner">
        ${item.certImage?`<img class="cert-image" src="${esc(item.certImage)}" alt="Attached photo" data-action="open-lightbox" data-url="${esc(item.certImage)}">
        <div class="photo-hint">Click the photo to view it full-size</div>`:''}
        ${linkRow}
      </div>
    </div>`;
  }
  function toggleCertBox(id){
    const box = document.getElementById("certbox-"+id);
    const trigger = document.querySelector(`.cert-trigger[data-id="${id}"]`);
    if(!box) return;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isOpen = box.classList.contains("open");
    const imgs = Array.from(box.querySelectorAll("img"));
    const measure = ()=>{ if(box.classList.contains("open")) box.style.maxHeight = box.scrollHeight + "px"; };
    if(isOpen){
      if(!reduceMotion){
        box.style.maxHeight = box.scrollHeight + "px";
        requestAnimationFrame(()=>{ box.style.maxHeight = "0px"; });
      } else {
        box.style.maxHeight = "0px";
      }
      box.classList.remove("open");
      if(trigger) trigger.classList.remove("open");
    } else {
      box.classList.add("open");
      if(trigger) trigger.classList.add("open");
      if(reduceMotion){
        box.style.maxHeight = "none";
      } else {
        measure();
        imgs.forEach(img=>{ if(!img.complete){ img.addEventListener("load", measure, {once:true}); } });
      }
    }
  }
  function showToast(msg, isError){
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 2800);
  }

  function openLightbox(images, startIndex){
    // Back-compat: allow the old openLightbox(url, caption) call shape too.
    if(typeof images === "string"){ images = [{url: images, caption: startIndex || ""}]; startIndex = 0; }
    images = (images || []).filter(im => im && im.url);
    if(images.length === 0) return;
    let index = Math.min(Math.max(startIndex || 0, 0), images.length - 1);
    const multi = images.length > 1;

    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.innerHTML = `
      <button class="lightbox-close" aria-label="Close" type="button">×</button>
      ${multi ? '<button class="lightbox-nav lightbox-prev" aria-label="Previous photo" type="button">‹</button>' : ''}
      ${multi ? '<button class="lightbox-nav lightbox-next" aria-label="Next photo" type="button">›</button>' : ''}
      ${multi ? '<div class="lightbox-counter"></div>' : ''}
      <img class="lightbox-img" src="" alt="">
      <div class="lightbox-caption"></div>
    `;
    document.body.appendChild(overlay);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const imgEl = overlay.querySelector(".lightbox-img");
    const captionEl = overlay.querySelector(".lightbox-caption");
    const counterEl = overlay.querySelector(".lightbox-counter");

    function show(i){
      index = (i + images.length) % images.length; // loop both directions
      const current = images[index];
      imgEl.src = current.url;
      imgEl.alt = current.caption || "Photo";
      captionEl.textContent = current.caption || "";
      captionEl.style.display = current.caption ? "" : "none";
      if(counterEl) counterEl.textContent = `${index + 1} / ${images.length}`;
    }
    show(index);

    function close(){
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e){
      if(e.key === "Escape") close();
      else if(multi && e.key === "ArrowLeft") show(index - 1);
      else if(multi && e.key === "ArrowRight") show(index + 1);
    }
    overlay.addEventListener("click", (e)=>{
      if(e.target === overlay || e.target.closest(".lightbox-close")) close();
      else if(e.target.closest(".lightbox-prev")) show(index - 1);
      else if(e.target.closest(".lightbox-next")) show(index + 1);
    });
    document.addEventListener("keydown", onKey);
  }

  function openMailClient(to, subject, body){
    const a = document.createElement("a");
    a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    a.click();
  }

  async function copyText(text){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){ /* fall through */ }
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }catch(e){ return false; }
  }

  function downloadVCard(){
    const p = data.profile || {};
    const c = data.contact || {};
    const lines = ["BEGIN:VCARD","VERSION:3.0", `FN:${p.name||"Contact"}`];
    if(p.title) lines.push(`TITLE:${p.title}`);
    if(c.email) lines.push(`EMAIL:${c.email}`);
    if(c.phone) lines.push(`TEL:${c.phone}`);
    if(c.location) lines.push(`ADR:;;${c.location};;;;`);
    lines.push("END:VCARD");
    downloadBlob(lines.join("\n"), `${(p.name||"contact").replace(/[^a-z0-9]+/gi,"-")}.vcf`, "text/vcard");
  }

  function downloadBlob(content, filename, mime){
    const blob = new Blob([content], {type:mime || "application/octet-stream"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }

  function blobToBase64(blob){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error("read failed"));
      reader.onload = ()=>{
        const result = reader.result;
        const commaIdx = result.indexOf(",");
        resolve(commaIdx>=0 ? result.slice(commaIdx+1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  async function uploadToServer(blob, filename, contentType){
    const dataBase64 = await blobToBase64(blob);
    const res = await fetch("/api/upload", {
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({filename, contentType, dataBase64})
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || "Upload failed.");
    }
    const json = await res.json();
    return json.url;
  }

  // Uploads an arbitrary file as-is (used for the certificate/attachment "file" slot).
  async function uploadRawFile(file){
    return uploadToServer(file, file.name, file.type || "application/octet-stream");
  }

  // Resizes an image client-side (to keep uploads small and fast) then uploads
  // the result to Vercel Blob, returning the resulting public URL.
  function uploadImageFile(file, maxDim, quality){
    maxDim = maxDim || 1400; quality = quality || 0.85;
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error("read failed"));
      reader.onload = ()=>{
        const img = new Image();
        img.onerror = ()=>reject(new Error("decode failed"));
        img.onload = ()=>{
          let w = img.width, h = img.height;
          if(w > maxDim || h > maxDim){
            if(w >= h){ h = Math.round(h * (maxDim / w)); w = maxDim; }
            else { w = Math.round(w * (maxDim / h)); h = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const isPng = /png/i.test(file.type) && file.size < 300000;
          const mime = isPng ? "image/png" : "image/jpeg";
          canvas.toBlob(async (blob)=>{
            if(!blob){ reject(new Error("couldn't process image")); return; }
            try{
              const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
              const ext = isPng ? "png" : "jpg";
              const url = await uploadToServer(blob, `${baseName}.${ext}`, mime);
              resolve(url);
            }catch(err){ reject(err); }
          }, mime, quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ============ Persistence ============ */
  function defaultData(){
    return {
      profile:{name:"Your Name", title:"", description:"", photo:"", socials:[]},
      achievements:[], education:[], skills:[], experience:[], projectCategories:[], projectPhotoSize:"M",
      contact:{email:"", phone:"", location:"", availability:"", preferred:"", resumeUrl:"", blurb:"", links:[]},
      customSections:[],
      profiles:[{id:"default", name:"Full Profile", hiddenSections:[], sectionOrder:[]}],
      activeProfileId:"default"
    };
  }
  function migrateProjects(obj){
    if(!obj.projectCategories){
      if(Array.isArray(obj.projects) && obj.projects.length){
        obj.projectCategories = [{id:uid(), title:"Projects", projects:obj.projects}];
      } else {
        obj.projectCategories = [];
      }
    }
    delete obj.projects;
  }
  // Profiles let you configure different named views of the same portfolio
  // (e.g. "School Profile" showing only some sections/entries). Whole
  // top-level sections can be hidden per profile via hiddenSections/
  // sectionOrder below. Individual entries (achievements, projects, skill
  // categories, experience items, custom-section items) can ALSO be scoped
  // to specific profiles via their own `profileIds` array — see
  // itemVisibleInProfile(). An entry with no profileIds (or an empty one)
  // is shared across every profile; that's the default for anything saved
  // before this existed, so nothing already on your site disappears.
  function migrateProfiles(obj){
    if(!Array.isArray(obj.profiles) || obj.profiles.length===0){
      obj.profiles = [{
        id:"default",
        name:"Full Profile",
        hiddenSections: Array.isArray(obj.hiddenSections) ? obj.hiddenSections : [],
        sectionOrder: Array.isArray(obj.sectionOrder) ? obj.sectionOrder : []
      }];
      obj.activeProfileId = "default";
    }
    if(!obj.activeProfileId || !obj.profiles.some(p=>p.id===obj.activeProfileId)){
      obj.activeProfileId = obj.profiles[0].id;
    }
    // Defensive: every profile object needs these two arrays, regardless of
    // how it got into obj.profiles (older saved data, a partially-applied
    // migration, manual edits, etc). Without this, any profile missing
    // either field crashes render() on every single call.
    obj.profiles.forEach(p=>{
      if(!Array.isArray(p.hiddenSections)) p.hiddenSections = [];
      if(!Array.isArray(p.sectionOrder)) p.sectionOrder = [];
    });
    delete obj.hiddenSections;
    delete obj.sectionOrder;
  }
  function getActiveProfile(){
    migrateProfiles(data);
    return data.profiles.find(p=>p.id===data.activeProfileId) || data.profiles[0];
  }

  // Whether a content entry (achievement, project, skill category, etc.)
  // should show up under the currently active profile. With only one
  // profile, scoping is moot — always visible. With multiple profiles,
  // an item only shows up in the profiles explicitly listed in its
  // profileIds; an empty/missing list means "not assigned to anything yet"
  // rather than "everywhere" — that's what makes a freshly created profile
  // start truly empty instead of inheriting all existing content.
  function itemVisibleInProfile(item){
    if(!data.profiles || data.profiles.length <= 1) return true;
    if(!item.profileIds || item.profileIds.length===0) return false;
    return item.profileIds.includes(getActiveProfile().id);
  }
  // Default scope for a BRAND NEW entry: if more than one profile exists,
  // scope it to just the profile you're currently viewing/editing — that's
  // the whole point (adding something while on "School Profile" shouldn't
  // silently also add it everywhere else). With only one profile, scoping
  // is meaningless, so just leave it unassigned.
  function defaultProfileIds(){
    return (data.profiles && data.profiles.length > 1) ? [getActiveProfile().id] : [];
  }
  // Adds the currently active profile to an item's allowlist, without
  // duplicating or disturbing any other profile it's already attached to.
  // Used both by the "Show in all profiles" style toggles and by "browse
  // existing" pickers that attach an already-existing entry to this profile.
  function browseExistingBtnHtml(action, id){
    if(!data.profiles || data.profiles.length <= 1) return "";
    return `<button class="btn sm ghost" data-action="${action}"${id?` data-id="${id}"`:''}>Browse existing</button>`;
  }
  function addActiveProfileTo(item){
    const pid = getActiveProfile().id;
    if(!item.profileIds) item.profileIds = [];
    if(!item.profileIds.includes(pid)) item.profileIds.push(pid);
  }

  // Generic "reuse an entry that already exists elsewhere" picker.
  // `entries` is [{id, title, subtitle}]; `onAttach(id)` does the actual
  // work of adding the current profile to that entry's scope.
  function openBrowseExistingModal(kindLabel, entries, onAttach){
    let html = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Add existing ${esc(kindLabel)}</h3>
        <div class="modal-sub">Reuse something already in another profile instead of retyping it. This adds it here — it stays wherever it already was too.</div>
        <div style="max-height:360px; overflow-y:auto; margin:14px 0; display:flex; flex-direction:column; gap:8px;">`;
    if(entries.length===0){
      html += `<div class="empty-state">Nothing else to reuse — everything you have is already in this profile.</div>`;
    } else {
      entries.forEach(it=>{
        html += `<div class="subrow-list-item" style="align-items:center;">
          <span><strong>${esc(it.title || "(untitled)")}</strong>${it.subtitle?` <span class="meta">${esc(it.subtitle)}</span>`:''}</span>
          <button class="btn ghost sm" type="button" data-action="browse-existing-pick" data-id="${it.id}">Add here</button>
        </div>`;
      });
    }
    html += `</div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Close</button>
        </div>
      </div>
    </div>`;
    modalRoot.innerHTML = html;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="browse-existing-pick"]').forEach(btn=>{
      btn.onclick = ()=>{ onAttach(btn.dataset.id); closeModal(); showToast("Added to this profile."); };
    });
  }
  function browseExistingRecords(kind){
    const list = kind === "achievement" ? data.achievements : data.education;
    const hidden = (list||[]).filter(item=>!itemVisibleInProfile(item));
    openBrowseExistingModal(kind === "achievement" ? "achievement" : "education entry", hidden.map(it=>({id:it.id, title:it.title, subtitle:it.org})), (id)=>{
      const item = list.find(x=>x.id===id);
      if(!item) return;
      addActiveProfileTo(item);
      persistAndRender();
    });
  }
  function browseExistingSkills(){
    const hidden = (data.skills||[]).filter(item=>!itemVisibleInProfile(item));
    openBrowseExistingModal("skill category", hidden.map(it=>({id:it.id, title:it.category, subtitle:(it.items||[]).slice(0,4).join(", ")})), (id)=>{
      const item = data.skills.find(x=>x.id===id);
      if(!item) return;
      addActiveProfileTo(item);
      persistAndRender();
    });
  }
  function browseExistingExpItems(sectionId){
    const sec = data.experience.find(s=>s.id===sectionId);
    if(!sec) return;
    const hidden = (sec.items||[]).filter(item=>!itemVisibleInProfile(item));
    openBrowseExistingModal("item", hidden.map(it=>({id:it.id, title:it.title, subtitle:it.subtitle})), (id)=>{
      const item = sec.items.find(x=>x.id===id);
      if(!item) return;
      addActiveProfileTo(item);
      persistAndRender();
    });
  }
  function browseExistingProjects(categoryId){
    const cat = data.projectCategories.find(c=>c.id===categoryId);
    if(!cat) return;
    const hidden = (cat.projects||[]).filter(item=>!itemVisibleInProfile(item));
    openBrowseExistingModal("project", hidden.map(it=>({id:it.id, title:it.header})), (id)=>{
      const item = cat.projects.find(x=>x.id===id);
      if(!item) return;
      addActiveProfileTo(item);
      persistAndRender();
    });
  }
  function browseExistingSectionItems(sectionId){
    const cs = data.customSections.find(c=>c.id===sectionId);
    if(!cs) return;
    const hidden = (cs.items||[]).filter(item=>!itemVisibleInProfile(item));
    openBrowseExistingModal("entry", hidden.map(it=>({id:it.id, title:it.title, subtitle:it.subtitle})), (id)=>{
      const item = cs.items.find(x=>x.id===id);
      if(!item) return;
      addActiveProfileTo(item);
      persistAndRender();
    });
  }
  // Reusable "Show in all profiles" checkbox markup for the hand-built
  // (non-generic-form) entry modals: achievement/education records,
  // projects, and custom-section items. Hidden entirely when there's only
  // one profile, since the choice wouldn't do anything.
  function profileScopeFieldHtml(item, fieldId){
    if(!data.profiles || data.profiles.length <= 1) return "";
    const allIds = data.profiles.map(p=>p.id);
    const checked = !!(item.profileIds && allIds.every(id=>item.profileIds.includes(id)));
    return `<div class="field" style="margin-top:16px;">
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; cursor:pointer;">
        <input type="checkbox" id="${fieldId}" ${checked?'checked':''} style="width:auto;">
        Show in all profiles${checked?'':` (currently only in "${esc(getActiveProfile().name)}")`}
      </label>
    </div>`;
  }
  function applyProfileScopeField(item, fieldId){
    const el = document.getElementById(fieldId);
    if(!el) return; // only one profile — field wasn't rendered, leave scope as-is
    item.profileIds = el.checked ? data.profiles.map(p=>p.id) : [getActiveProfile().id];
  }

  function ensureSectionOrder(viewProfile){
    const allKeys = FIXED_SECTIONS.map(s=>s.key).concat(data.customSections.map(cs=>"custom:"+cs.id));
    if(!Array.isArray(viewProfile.hiddenSections)) viewProfile.hiddenSections = [];
    viewProfile.hiddenSections = viewProfile.hiddenSections.filter(k=>allKeys.includes(k));
    if(!Array.isArray(viewProfile.sectionOrder)) viewProfile.sectionOrder = [];
    viewProfile.sectionOrder = viewProfile.sectionOrder.filter(k=>allKeys.includes(k));
    allKeys.forEach(k=>{ if(!viewProfile.sectionOrder.includes(k)) viewProfile.sectionOrder.push(k); });
  }
  function getOrderedSectionMeta(){
    const viewProfile = getActiveProfile();
    ensureSectionOrder(viewProfile);
    return viewProfile.sectionOrder.map(key=>{
      if(key.startsWith("custom:")){
        const cs = data.customSections.find(c=>c.id===key.slice(7));
        return cs ? {key, label:cs.title, isCustom:true} : null;
      }
      const fs = FIXED_SECTIONS.find(s=>s.key===key);
      return fs ? {key, label:fs.label, isCustom:false} : null;
    }).filter(Boolean);
  }

  async function loadAll(){
    try{
      const res = await fetch("/api/data", {credentials:"same-origin", cache:"no-store"});
      data = res.ok ? await res.json() : defaultData();
    }catch(e){ data = defaultData(); }
    if(!data.customSections) data.customSections = [];
    if(!data.contact) data.contact = defaultData().contact;
    if(!data.contact.links) data.contact.links = [];
    if(!data.profile) data.profile = defaultData().profile;
    if(!data.projectPhotoSize) data.projectPhotoSize = "M";
    migrateProjects(data);
    migrateProfiles(data);

    // Always start from a clean, logged-out slate on a fresh page load —
    // a refresh should never silently resume edit mode from a lingering
    // session. This actually invalidates the session server-side (not
    // just hiding it client-side), so re-entering edit mode always
    // requires the password + email code again.
    try{ await callAuthApi({action:"logout"}); }catch(e){ /* best effort */ }

    try{
      const res = await fetch("/api/auth", {credentials:"same-origin", cache:"no-store"});
      authState = res.ok ? await res.json() : {hasPassword:false, authenticated:false};
    }catch(e){ authState = {hasPassword:false, authenticated:false}; }
    state.editing = false;

    try{
      const raw = localStorage.getItem(PREFS_KEY);
      if(raw) prefs = Object.assign({theme:"paper", size:"md"}, JSON.parse(raw));
    }catch(e){ /* defaults are fine */ }
    applyPrefs();
  }

  async function saveData(){
    try{
      const res = await fetch("/api/data", {
        method:"POST", credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(data)
      });
      if(!res.ok){
        const err = await res.json().catch(()=>({}));
        if(res.status === 401){
          showToast("Your edit session expired — click your name to unlock again.", true);
          state.editing = false; render();
        } else {
          showToast(err.error || "Couldn't save — try again.", true);
        }
        return false;
      }
      return true;
    }catch(e){ showToast("Couldn't save — check your connection.", true); return false; }
  }
  function savePrefs(){
    try{ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
    catch(e){ /* non-critical */ }
  }
  function applyPrefs(){
    document.documentElement.setAttribute("data-theme", prefs.theme);
    document.documentElement.setAttribute("data-size", prefs.size);
  }
  function persistAndRender(){ render(); saveData(); }

  /* ============ Render root ============ */
  function render(){
    const editing = state.editing;
    const viewProfile = getActiveProfile();
    ensureSectionOrder(viewProfile);
    if(!editing && viewProfile.hiddenSections.includes(state.section)){ state.section = "home"; }

    let html = "";
    html += renderSiteHeader(editing);
    html += renderTopbar(editing);
    if(editing) html += renderEditbar();

    html += `<nav class="tabs-row" role="tablist">`;
    getOrderedSectionMeta().forEach(s=>{
      const hidden = !s.isCustom && viewProfile.hiddenSections.includes(s.key);
      if(hidden && !editing) return;
      html += `<button class="tab ${state.section===s.key?'active':''}" role="tab" data-action="nav" data-section="${s.key}" style="${hidden?'opacity:.45;':''}">${esc(s.label)}${hidden?' <span class="mono" style="font-size:.62rem;">(hidden)</span>':''}</button>`;
    });
    if(editing){ html += `<button class="tab add-tab" data-action="add-section">+ Section</button>`; }
    html += `</nav>`;

    html += `<main class="stage">`;
    if(state.section.startsWith("custom:")){
      const id = state.section.slice(7);
      const cs = data.customSections.find(c=>c.id===id);
      html += cs ? renderCustomSection(cs, editing) : `<div class="empty-state">This section was removed.</div>`;
    } else {
      switch(state.section){
        case "home": html += renderHome(editing); break;
        case "achievements": html += renderAchievements(editing); break;
        case "projects": html += renderProjects(editing); break;
        case "skills": html += renderSkills(editing); break;
        case "experience": html += renderExperience(editing); break;
        case "contact": html += renderContact(editing); break;
      }
    }
    html += `</main>`;
    html += `<footer class="pagefoot">Portfolio</footer>`;
    page.innerHTML = html;
  }

  function renderSiteHeader(editing){
    const name = (data.profile && data.profile.name) ? data.profile.name : "Portfolio";
    return `<div class="sitehead">
      <button class="brandname ${editing?'is-editing':''}" data-action="toggle-edit" title="${editing ? 'Exit edit mode' : 'Click to edit this portfolio'}">
        ${esc(name)}${editing?'<span class="caret">editing…</span>':''}
      </button>
    </div>`;
  }

  function renderTopbar(editing){
    const themes = [["paper","Paper"],["light","Light"],["sepia","Sepia"],["dark","Dark"]];
    const sizes = [["sm","S"],["md","M"],["lg","L"],["xl","XL"]];
    return `
    <div class="toprow">
      <div class="prefs">
        <span class="prefs-label">Theme</span>
        <div class="prefs-group" role="group" aria-label="Theme">
          ${themes.map(t=>`<button data-action="set-theme" data-value="${t[0]}" class="${prefs.theme===t[0]?'active':''}">${t[1]}</button>`).join("")}
        </div>
        <span class="prefs-label">Text size</span>
        <div class="prefs-group size" role="group" aria-label="Text size">
          ${sizes.map((t,i)=>`<button data-action="set-size" data-value="${t[0]}" class="${prefs.size===t[0]?'active':''}" style="font-size:${0.72+i*0.14}rem;">${t[1]}</button>`).join("")}
        </div>
      </div>
    </div>`;
  }

  function renderEditbar(){
    const viewProfile = getActiveProfile();
    let html = `<div class="editbar">`;
    html += `<span>You're editing — changes save automatically for everyone.</span>`;
    html += `<button class="linklike" data-action="manage-profiles">Viewing: ${esc(viewProfile.name)} ▾</button>`;
    html += `<button class="linklike" data-action="manage-sections">Manage sections</button>`;
    html += `<button class="linklike" data-action="change-password">Change password</button>`;
    html += `<button class="linklike" data-action="logout">Log out</button>`;
    html += `</div>`;
    return html;
  }

  /* ============ HOME ============ */
  function renderHome(editing){
    const p = data.profile;
    let html = `<div class="home-hero"><div class="home-top">`;
    html += renderPhotoFrame(p, editing);
    html += `<div class="home-textcol">`;
    if(editing){
      html += `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:2px;">
        <button class="btn ghost sm" data-action="edit-profile">Edit intro</button>
        <button class="btn ghost sm" data-action="edit-socials">Edit links</button>
      </div>`;
    }
    html += `<h1 class="home-name">${esc(p.name)}</h1>`;
    if(p.title) html += `<div class="home-title">${esc(p.title)}</div>`;
    if(p.description) html += `<p class="home-desc">${nl2br(p.description)}</p>`;
    html += `<div class="socials-row">`;
    if(!p.socials || p.socials.length===0){
      html += editing ? `<span class="hint" style="margin:0;">No links yet — add as many as you like with "Edit links".</span>` : "";
    } else {
      p.socials.forEach(s=>{ html += `<a class="social-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`; });
    }
    html += `</div></div></div></div>`;
    return html;
  }

  function renderPhotoFrame(p, editing){
    const inner = p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<div class="photo-placeholder">${esc(getInitials(p.name))}</div>`;
    let html = `<div class="home-photo-wrap"><div class="home-photo">${inner}</div>`;
    if(editing){
      html += `<div class="photo-actions">
        <label class="btn ghost sm" for="profile_photo_file" style="cursor:pointer;">${p.photo ? "Change photo" : "Add photo"}</label>
        <button class="btn ghost sm" data-action="browse-profile-photo">Browse library</button>
        ${p.photo ? `<button class="btn ghost sm" data-action="remove-photo" style="border-color:var(--danger); color:var(--danger);">Remove</button>` : ""}
        <input type="file" id="profile_photo_file" accept="image/*" style="display:none;">
      </div>`;
    }
    html += `</div>`;
    return html;
  }

  /* ============ ACHIEVEMENTS & EDUCATION ============ */
  function renderAchievements(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Record</span><h2>Achievements & Education</h2></div></div>`;
    html += `<div class="subhead"><h3>Achievements</h3>${editing?`<div style="display:flex; gap:10px;"><button class="btn sm accent" data-action="add-achievement">+ Add</button>${browseExistingBtnHtml("browse-existing-achievement")}</div>`:''}</div>`;
    html += renderRecordList(data.achievements, "achievement", editing);
    html += `<div class="subhead"><h3>Education</h3>${editing?`<div style="display:flex; gap:10px;"><button class="btn sm accent" data-action="add-education">+ Add</button>${browseExistingBtnHtml("browse-existing-education")}</div>`:''}</div>`;
    html += renderRecordList(data.education, "education", editing);
    return html;
  }
  function renderRecordList(fullList, kind, editing){
    const list = (fullList||[]).filter(itemVisibleInProfile);
    if(list.length===0){
      if(editing && fullList && fullList.length>0){
        return `<div class="empty-state">Nothing in this profile — ${fullList.length} ${fullList.length===1?"entry exists":"entries exist"} in other profiles.</div>`;
      }
      return `<div class="empty-state">${editing ? "Nothing here yet — add the first entry above." : "Nothing added yet."}</div>`;
    }
    let html = "";
    list.forEach((item, idx)=>{
      html += `<div class="entry">
        <div class="entry-top">
          <div>
            <div class="entry-title">${esc(item.title)}</div>
            <div class="entry-meta">${esc(item.org)}${item.org && item.date ? " · " : ""}${esc(item.date)}</div>
          </div>
          ${editing?`<div class="entry-actions">
            ${moveButtons(kind==="achievement"?"achievements":"education", item.id, null, idx, list.length)}
            <button class="textlink" data-action="edit-${kind}" data-id="${item.id}">Edit</button>
            <button class="textlink danger" data-action="delete-${kind}" data-id="${item.id}">Delete</button>
          </div>`:''}
        </div>
        ${item.description ? `<div class="entry-desc">${nl2br(item.description)}</div>` : ""}
        ${renderCertTrigger(item)}
      </div>`;
    });
    return html;
  }

  /* ============ PROJECTS ============ */
  function renderProjects(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Build log</span><h2>Projects</h2></div>${editing?'<button class="btn accent" data-action="add-project-category">+ Add category</button>':''}</div>`;
    if(editing){
      const sizes = ["S","M","L"];
      const current = data.projectPhotoSize || "M";
      html += `<div class="prefs" style="margin-bottom:22px;">
        <span class="prefs-label">Photo size</span>
        <div class="prefs-group" role="group" aria-label="Project photo size">
          ${sizes.map(s=>`<button data-action="set-project-photo-size" data-value="${s}" class="${current===s?'active':''}">${s}</button>`).join("")}
        </div>
      </div>`;
    }
    if(!data.projectCategories || data.projectCategories.length===0){
      html += `<div class="empty-state">${editing ? 'No categories yet — add one above (e.g. "Web Apps", "Client Work").' : "Projects are on their way — check back soon."}</div>`;
      return html;
    }
    data.projectCategories.forEach((cat, catIdx)=>{
      const allProjects = cat.projects || [];
      const catProjects = allProjects.filter(itemVisibleInProfile);
      if(!editing && catProjects.length===0 && allProjects.length>0) return; // fully hidden by profile scoping, not genuinely empty
      html += `<div class="group">
        <div class="group-head">
          <h3>${esc(cat.title)}</h3>
          ${editing?`<div class="group-actions">
            ${moveButtons("projectCategories", cat.id, null, catIdx, data.projectCategories.length)}
            <button class="textlink" data-action="edit-project-category" data-id="${cat.id}">Rename</button>
            <button class="textlink" data-action="add-project" data-id="${cat.id}">+ Add project</button>
            ${data.profiles && data.profiles.length>1 ? `<button class="textlink" data-action="browse-existing-project" data-id="${cat.id}">Browse existing</button>` : ''}
            <button class="textlink danger" data-action="delete-project-category" data-id="${cat.id}">Delete category</button>
          </div>`:''}
        </div>`;
      if(catProjects.length===0){
        if(editing && allProjects.length>0){
          html += `<div class="empty-state">Nothing in this profile — ${allProjects.length} ${allProjects.length===1?"project exists":"projects exist"} in other profiles.</div>`;
        } else {
          html += `<div class="empty-state">${editing?"No projects yet in this category.":"Nothing here yet."}</div>`;
        }
      } else {
        catProjects.forEach((pr, prIdx)=>{ html += renderProjectCard(pr, editing, cat.id, prIdx, catProjects.length); });
      }
      html += `</div>`;
    });
    return html;
  }
  function renderProjectCard(pr, editing, categoryId, idx, length){
    return `<div class="project">
      <div class="project-head">
        <h3>${esc(pr.header)}</h3>
        ${editing?`<div class="entry-actions">
          ${moveButtons("projects", pr.id, categoryId, idx, length)}
          <button class="textlink" data-action="edit-project" data-id="${pr.id}" data-section-id="${categoryId}">Edit</button>
          <button class="textlink danger" data-action="delete-project" data-id="${pr.id}" data-section-id="${categoryId}">Delete</button>
        </div>`:''}
      </div>
      ${pr.description?`<p class="entry-desc" style="margin-top:6px;">${nl2br(pr.description)}</p>`:''}
      ${(pr.tags&&pr.tags.length)?`<div style="margin-top:8px;">${pr.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`:''}
      ${renderProjectAttachments(pr)}
    </div>`;
  }
  // Links, files, and photos all collapse behind a single click-to-expand
  // toggle (same pattern as achievements/education). Photos still get a
  // hover zoom and open in the full-size lightbox on click — collapsing
  // them behind the toggle doesn't give that up.
  function renderProjectAttachments(pr){
    const linkItems = [...(pr.links||[]), ...(pr.files||[]).map(f=>({...f, type:"download"}))];
    const images = pr.images || [];
    const total = linkItems.length + images.length;
    if(total===0) return "";
    const linksHtml = linkItems.length ? `<div class="cert-links"${images.length?' style="margin-bottom:14px;"':''}>${linkItems.map(l=>{
      const badge = l.type === "download" ? "Download ↓" : (l.type === "github" ? "GitHub ↗" : (l.type === "live" || l.type==="demo" ? "Live ↗" : "Link ↗"));
      return `<a class="cert-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || badge)}</a>`;
    }).join("")}</div>` : '';
    const sizeClass = "size-" + (data.projectPhotoSize || "M").toLowerCase();
    const imagesHtml = images.length ? `<div class="project-images ${sizeClass}">${images.map(img=>
      `<figure><img src="${esc(img.url)}" alt="${esc(img.caption||pr.header)}" loading="lazy" data-action="open-lightbox" data-url="${esc(img.url)}" data-caption="${esc(img.caption||'')}">${img.caption?`<figcaption>${esc(img.caption)}</figcaption>`:''}</figure>`
    ).join("")}</div>` : '';
    return `<button class="cert-trigger" data-action="toggle-cert" data-id="${pr.id}">
      <span class="cert-trigger-label">Links & photos (${total})</span>
      <span class="cert-chevron">⌄</span>
    </button>
    <div class="cert-box" id="certbox-${pr.id}">
      <div class="cert-box-inner">
        ${linksHtml}
        ${imagesHtml}
      </div>
    </div>`;
  }


  /* ============ SKILLS ============ */
  function renderSkills(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Toolkit</span><h2>Skills</h2></div>${editing?`<div style="display:flex; gap:10px;"><button class="btn accent" data-action="add-skill">+ Add category</button>${browseExistingBtnHtml("browse-existing-skill")}</div>`:''}</div>`;
    const allSkills = data.skills || [];
    const skills = allSkills.filter(itemVisibleInProfile);
    if(skills.length===0){
      if(editing && allSkills.length>0){
        html += `<div class="empty-state">Nothing in this profile — ${allSkills.length} ${allSkills.length===1?"category exists":"categories exist"} in other profiles.</div>`;
      } else {
        html += `<div class="empty-state">${editing?"No skill categories yet — add one above.":"Nothing added yet."}</div>`;
      }
      return html;
    }
    skills.forEach((cat, idx)=>{
      html += `<div class="entry">
        <div class="entry-top">
          <div class="entry-title" style="font-size:1rem;">${esc(cat.category)}</div>
          ${editing?`<div class="entry-actions">
            ${moveButtons("skills", cat.id, null, idx, skills.length)}
            <button class="textlink" data-action="edit-skill" data-id="${cat.id}">Edit</button>
            <button class="textlink danger" data-action="delete-skill" data-id="${cat.id}">Delete</button>
          </div>`:''}
        </div>
        <div style="margin-top:8px;">${(cat.items||[]).map(i=>`<span class="tag">${esc(i)}</span>`).join("") || '<span class="hint" style="margin:0;">No skills listed.</span>'}</div>
      </div>`;
    });
    return html;
  }

  /* ============ EXPERIENCE ============ */
  function renderExperience(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Track record</span><h2>Experience</h2></div>${editing?'<button class="btn accent" data-action="add-exp-section">+ Add section</button>':''}</div>`;
    if(!data.experience || data.experience.length===0){
      html += `<div class="empty-state">${editing?'No sections yet — add one above (e.g. "Work Experience").':"Nothing added yet."}</div>`;
      return html;
    }
    data.experience.forEach((sec, secIdx)=>{
      html += `<div class="group">
        <div class="group-head">
          <h3>${esc(sec.sectionTitle)}</h3>
          ${editing?`<div class="group-actions">
            ${moveButtons("experience", sec.id, null, secIdx, data.experience.length)}
            <button class="textlink" data-action="edit-exp-section" data-id="${sec.id}">Rename</button>
            <button class="textlink" data-action="add-exp-item" data-id="${sec.id}">+ Add item</button>
            ${data.profiles && data.profiles.length>1 ? `<button class="textlink" data-action="browse-existing-exp-item" data-id="${sec.id}">Browse existing</button>` : ''}
            <button class="textlink danger" data-action="delete-exp-section" data-id="${sec.id}">Delete section</button>
          </div>`:''}
        </div>`;
      const allItems = sec.items || [];
      const items = allItems.filter(itemVisibleInProfile);
      if(items.length===0){
        if(editing && allItems.length>0){
          html += `<div class="empty-state">Nothing in this profile — ${allItems.length} ${allItems.length===1?"item exists":"items exist"} in other profiles.</div>`;
        } else {
          html += `<div class="empty-state">${editing?"No items yet in this section.":"Nothing here yet."}</div>`;
        }
      } else {
        items.forEach((item, itemIdx)=>{
          html += `<div class="entry">
            <div class="entry-top">
              <div>
                <div class="entry-title" style="font-size:1rem;">${esc(item.title)}</div>
                <div class="entry-meta">${esc(item.subtitle)}${item.subtitle && item.date ? " · " : ""}${esc(item.date)}</div>
              </div>
              ${editing?`<div class="entry-actions">
                ${moveButtons("expItems", item.id, sec.id, itemIdx, items.length)}
                <button class="textlink" data-action="edit-exp-item" data-id="${item.id}" data-section-id="${sec.id}">Edit</button>
                <button class="textlink danger" data-action="delete-exp-item" data-id="${item.id}" data-section-id="${sec.id}">Delete</button>
              </div>`:''}
            </div>
            ${item.description?`<div class="entry-desc">${nl2br(item.description)}</div>`:''}
          </div>`;
        });
      }
      html += `</div>`;
    });
    return html;
  }

  /* ============ CUSTOM SECTIONS ============ */
  function renderCustomSection(cs, editing){
    let html = `<div class="section-heading">
      <div><span class="section-eyebrow">Custom section</span><h2>${esc(cs.title)}</h2></div>
      ${editing?`<div class="group-actions">
        <button class="btn ghost sm" data-action="rename-section" data-id="${cs.id}">Rename</button>
        <button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="delete-section" data-id="${cs.id}">Delete section</button>
      </div>`:''}
    </div>`;
    if(editing){ html += `<button class="btn ghost sm" data-action="edit-section-intro" data-id="${cs.id}" style="margin-bottom:14px;">${cs.intro ? "Edit intro text" : "+ Add intro text"}</button>`; }
    if(cs.intro) html += `<p class="intro-text">${nl2br(cs.intro)}</p>`;

    const hasBullets = cs.bullets && cs.bullets.length;
    const allItems = cs.items || [];
    const items = allItems.filter(itemVisibleInProfile);
    const hasItems = items.length > 0;

    if(hasBullets || editing){
      html += `<div class="subhead"><h3>Notes</h3>${editing?`<div style="display:flex; gap:12px;">
        <button class="textlink" data-action="edit-section-bullets" data-id="${cs.id}">${hasBullets?"Edit list":"+ Add list"}</button>
        ${hasBullets?`<button class="textlink danger" data-action="remove-section-bullets" data-id="${cs.id}">Remove list</button>`:''}
      </div>`:''}</div>`;
      if(hasBullets){
        html += `<ul class="bullets">` + cs.bullets.map(b=>`<li>${esc(b)}</li>`).join("") + `</ul>`;
      } else if(editing){
        html += `<div class="hint" style="margin:0 0 14px;">No list yet — notes are optional.</div>`;
      }
    }

    if(hasItems || editing){
      html += `<div class="subhead"><h3>Entries</h3>${editing?`<div style="display:flex; gap:10px;"><button class="btn sm accent" data-action="add-section-item" data-id="${cs.id}">+ Add entry</button>${browseExistingBtnHtml("browse-existing-section-item", cs.id)}</div>`:''}</div>`;
      if(hasItems){
        items.forEach((item, itemIdx)=>{
          html += `<div class="entry">
            <div class="entry-top">
              <div>
                <div class="entry-title" style="font-size:1rem;">${esc(item.title)}</div>
                <div class="entry-meta">${esc(item.subtitle)}${item.subtitle && item.date ? " · " : ""}${esc(item.date)}</div>
              </div>
              ${editing?`<div class="entry-actions">
                ${moveButtons("sectionItems", item.id, cs.id, itemIdx, items.length)}
                <button class="textlink" data-action="edit-section-item" data-id="${item.id}" data-section-id="${cs.id}">Edit</button>
                <button class="textlink danger" data-action="delete-section-item" data-id="${item.id}" data-section-id="${cs.id}">Delete</button>
              </div>`:''}
            </div>
            ${item.description?`<div class="entry-desc">${nl2br(item.description)}</div>`:''}
            ${renderCertTrigger(item)}
          </div>`;
        });
      } else if(editing && allItems.length>0){
        html += `<div class="hint" style="margin:0;">Nothing in this profile — ${allItems.length} ${allItems.length===1?"entry exists":"entries exist"} in other profiles.</div>`;
      } else if(editing){
        html += `<div class="hint" style="margin:0;">No entries yet — entries are optional too.</div>`;
      }
    }

    if(!cs.intro && !hasBullets && !hasItems && !editing){
      html += `<div class="empty-state">Nothing here yet.</div>`;
    }
    return html;
  }

  /* ============ CONTACT ============ */
  function renderContact(editing){
    const c = Object.assign({email:"",phone:"",location:"",availability:"",preferred:"",resumeUrl:"",blurb:"",links:[]}, data.contact||{});
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Get in touch</span><h2>Contact</h2></div>${editing?'<button class="btn ghost sm" data-action="edit-contact">Edit</button>':''}</div>`;
    if(c.blurb) html += `<p class="blurb">${nl2br(c.blurb)}</p>`;

    const rows = [
      ["Email", c.email], ["Phone", c.phone], ["Location", c.location],
      ["Availability", c.availability], ["Preferred contact", c.preferred]
    ].filter(([,val])=>val);

    html += `<div class="subhead" style="margin-top:${c.blurb?'26px':'0'};"><h3>Contact Details</h3></div>`;
    if(rows.length){
      html += `<dl class="contact-grid">`;
      rows.forEach(([label,val])=>{ html += `<div class="contact-row"><dt>${esc(label)}</dt><dd>${esc(val)}</dd></div>`; });
      html += `</dl>`;
    } else if(!editing){
      html += `<div class="empty-state">Contact details coming soon.</div>`;
    } else {
      html += `<div class="empty-state">No details yet — add your email and any other details with "Edit".</div>`;
    }

    const hasVcard = c.email || c.phone;
    if(c.email || c.resumeUrl || hasVcard){
      html += `<div class="contact-actions">`;
      if(c.email){ html += `<button class="btn ghost" data-action="copy-email" data-value="${esc(c.email)}">Copy email address</button>`; }
      if(hasVcard){ html += `<button class="btn ghost" data-action="download-vcard">Save contact card</button>`; }
      if(c.resumeUrl){ html += `<a class="btn ghost" href="${esc(c.resumeUrl)}" target="_blank" rel="noopener">Download résumé</a>`; }
      html += `</div>`;
    }

    const hasContactLinks = c.links && c.links.length;
    if(hasContactLinks || editing){
      html += `<div class="subhead"><h3>Additional Links</h3>${editing?`<button class="textlink" data-action="edit-contact-links">Edit links</button>`:''}</div>`;
      if(hasContactLinks){
        html += `<div class="socials-row">` + c.links.map(l=>`<a class="social-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("") + `</div>`;
      } else if(editing){
        html += `<div class="hint" style="margin:0;">No extra links yet — add a scheduling page, WhatsApp, Discord, or anything else you'd like here.</div>`;
      }
    }

    html += `<div class="subhead"><h3>Send a Message</h3></div>`;
    html += `<div class="msg-form">
      <div class="field"><label>Name</label><input id="msg_name" placeholder="Your name"></div>
      <div class="field"><label>Your email</label><input id="msg_email" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Subject (optional)</label><input id="msg_subject" placeholder="e.g. Project inquiry"></div>
      <div class="field"><label>Message</label><textarea id="msg_body" placeholder="Share a few details about your inquiry" style="min-height:100px;"></textarea></div>
      <button class="btn accent" data-action="send-message">Send message</button>
      <span class="hint" style="margin:8px 0 0; display:block;">Sending opens your default email application with this message ready to go.</span>
    </div>`;
    return html;
  }

  /* ============ Modal helpers ============ */
  function closeModal(){ modalRoot.innerHTML = ""; }

  /* ============ Media library (reuse previously uploaded files) ============ */
  async function fetchMediaLibrary(){
    try{
      const res = await fetch("/api/media", {credentials:"same-origin", cache:"no-store"});
      const json = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(json.error || "Couldn't load your library.");
      return json.items || [];
    }catch(err){
      showToast(err.message || "Couldn't load your library.", true);
      return null;
    }
  }
  function libraryFileName(pathname){
    const base = (pathname || "").split("/").pop() || "file";
    // uploads are stored as "<uuid>-<original name>" — strip the uuid prefix for display
    return base.replace(/^[a-f0-9-]{20,}-/i, "");
  }
  async function openMediaLibraryModal(onSelect, imagesOnly){
    const items = await fetchMediaLibrary();
    if(items === null) return; // error already toasted
    renderMediaLibraryModal(items, onSelect, imagesOnly);
  }
  function renderMediaLibraryModal(items, onSelect, imagesOnly){
    const filtered = imagesOnly ? items.filter(it=>it.contentType && it.contentType.startsWith("image/")) : items;
    const grid = filtered.length ? filtered.map(it=>{
      const name = libraryFileName(it.pathname);
      const isImage = it.contentType && it.contentType.startsWith("image/");
      const thumb = isImage
        ? `<img src="${esc(it.url)}" alt="${esc(name)}" style="width:100%; height:84px; object-fit:cover; border-radius:6px; border:1px solid var(--line-strong); display:block;">`
        : `<div style="width:100%; height:84px; border-radius:6px; border:1px solid var(--line-strong); display:flex; align-items:center; justify-content:center; background:var(--bg); font-family:'JetBrains Mono',monospace; font-size:.62rem; color:var(--muted); text-align:center; padding:6px; overflow:hidden;">${esc(name.slice(0,26))}</div>`;
      return `<button type="button" class="media-item" data-url="${esc(it.url)}" data-name="${esc(name)}" style="display:block; width:100%; text-align:left; background:none; border:none; padding:0; cursor:pointer;">
        ${thumb}
        <div style="font-size:.62rem; color:var(--muted); margin-top:4px; font-family:'JetBrains Mono',monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(name)}</div>
      </button>`;
    }).join("") : `<div class="hint" style="margin:0;">${imagesOnly ? "No photos uploaded yet." : "No files uploaded yet."} Upload one somewhere first and it'll show up here to reuse.</div>`;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true" style="max-width:600px;">
        <h3>Choose from your library</h3>
        <div class="modal-sub">Reuse something you've already uploaded instead of uploading a duplicate copy.</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(108px,1fr)); gap:10px; max-height:52vh; overflow-y:auto; margin-bottom:14px;">${grid}</div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll(".media-item").forEach(btn=>{
      btn.onclick = ()=>{ onSelect(btn.dataset.url, btn.dataset.name); };
    });
  }

  function openFormModal(cfg){
    let html = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${esc(cfg.title)}</h3>
        ${cfg.sub?`<div class="modal-sub">${esc(cfg.sub)}</div>`:''}
        <form id="dyn-form">`;
    cfg.fields.forEach(f=>{
      if(f.type === "checkbox"){
        html += `<div class="field"><label style="display:flex; align-items:center; gap:8px; font-weight:400; cursor:pointer;">
          <input type="checkbox" id="f_${f.name}" name="${f.name}" ${f.checked?'checked':''} style="width:auto;"> ${esc(f.label)}
        </label></div>`;
        return;
      }
      html += `<div class="field"><label for="f_${f.name}">${esc(f.label)}${f.required?' *':''}</label>`;
      if(f.type === "textarea"){
        html += `<textarea id="f_${f.name}" name="${f.name}" placeholder="${esc(f.placeholder||'')}">${esc(f.value||'')}</textarea>`;
      } else {
        html += `<input id="f_${f.name}" name="${f.name}" type="${f.type||'text'}" value="${esc(f.value||'')}" placeholder="${esc(f.placeholder||'')}">`;
      }
      html += `</div>`;
    });
    html += `</form>
        ${cfg.footerLink ? `<div style="margin-top:10px;"><button type="button" class="textlink" data-action="modal-footer-link">${esc(cfg.footerLink)}</button></div>` : ''}
        <div class="modal-actions">
          ${cfg.onDelete ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="modal-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="modal-submit">${esc(cfg.submitLabel||'Save')}</button>
        </div>
      </div>
    </div>`;
    modalRoot.innerHTML = html;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    if(cfg.onDelete){ modalRoot.querySelector('[data-action="modal-delete"]').onclick = ()=>{ cfg.onDelete(); closeModal(); }; }
    if(cfg.footerLink){ modalRoot.querySelector('[data-action="modal-footer-link"]').onclick = ()=>{ closeModal(); cfg.onFooterLink(); }; }
    function doSubmit(){
      const values = {}; let missing = false;
      cfg.fields.forEach(f=>{
        const el = document.getElementById("f_"+f.name);
        if(f.type === "checkbox"){ values[f.name] = el.checked; return; }
        values[f.name] = el.value.trim();
        if(f.required && !values[f.name]) missing = true;
      });
      if(missing){ showToast("Please fill in the required fields.", true); return; }
      cfg.onSubmit(values);
      closeModal();
    }
    const formEl = document.getElementById("dyn-form");
    if(formEl){ formEl.addEventListener("submit", (e)=>{ e.preventDefault(); doSubmit(); }); }
    modalRoot.querySelector('[data-action="modal-submit"]').onclick = doSubmit;
  }

  /* ============ Auth modals ============ */
  async function callAuthApi(payload){
    const res = await fetch("/api/auth", {
      method:"POST", credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(()=>({}));
    return {ok: res.ok, ...json};
  }

  function openCodeModal(challenge, verifyAction, onSuccess){
    openFormModal({
      title:"Enter verification code",
      sub:`We sent a 6-digit code to your email — it expires in 10 minutes.`,
      fields:[{name:"code", label:"Verification code", placeholder:"000000", required:true}],
      submitLabel:"Verify",
      onSubmit: async(v)=>{
        const result = await callAuthApi({action:verifyAction, challenge, code:v.code.trim()});
        if(!result.ok){ showToast(result.error || "That code isn't right.", true); return; }
        onSuccess();
      }
    });
  }

  function openAuthModal(){
    if(!authState.hasPassword){
      openFormModal({
        title:"Set an edit password",
        sub:"This unlocks edit mode for everyone who knows it — it's checked on the server and hashed before storage, never kept as plain text. We'll also email a verification code to confirm it's really you before it's active.",
        fields:[
          {name:"pw", label:"New password", type:"password", required:true},
          {name:"pw2", label:"Confirm password", type:"password", required:true}
        ],
        submitLabel:"Send verification code",
        onSubmit:async(v)=>{
          if(v.pw !== v.pw2){ showToast("Passwords don't match.", true); return; }
          if(v.pw.length < 4){ showToast("Use at least 4 characters.", true); return; }
          const result = await callAuthApi({action:"setup-request", password:v.pw});
          if(!result.ok){ showToast(result.error || "Couldn't start setup.", true); return; }
          showToast("Verification code sent to your email");
          openCodeModal(result.challenge, "setup-verify", ()=>{
            authState = {hasPassword:true, authenticated:true};
            state.editing = true; render();
            showToast("Edit mode unlocked");
          });
        }
      });
    } else {
      openFormModal({
        title:"Enter edit password",
        fields:[{name:"pw", label:"Password", type:"password", required:true}],
        submitLabel:"Send verification code",
        footerLink:"Forgot password?",
        onFooterLink: openResetPasswordModal,
        onSubmit:async(v)=>{
          const result = await callAuthApi({action:"login-request", password:v.pw});
          if(!result.ok){ showToast(result.error || "That password isn't right.", true); return; }
          showToast("Verification code sent to your email");
          openCodeModal(result.challenge, "login-verify", ()=>{
            authState = {hasPassword:true, authenticated:true};
            state.editing = true; render();
            showToast("Edit mode unlocked");
          });
        }
      });
    }
  }

  function openResetPasswordModal(){
    openFormModal({
      title:"Reset password",
      sub:"Enter the email this portfolio is set up with — we'll email it a verification code to confirm it's really you, then set this as your new password.",
      fields:[
        {name:"email", label:"Account email", type:"email", required:true, placeholder:"you@example.com"},
        {name:"pw", label:"New password", type:"password", required:true},
        {name:"pw2", label:"Confirm new password", type:"password", required:true}
      ],
      submitLabel:"Send verification code",
      onSubmit:async(v)=>{
        if(v.pw !== v.pw2){ showToast("Passwords don't match.", true); return; }
        if(v.pw.length < 4){ showToast("Use at least 4 characters.", true); return; }
        const result = await callAuthApi({action:"reset-request", email:v.email, newPassword:v.pw});
        if(!result.ok){ showToast(result.error || "Couldn't start the reset.", true); return; }
        showToast("Verification code sent to your email");
        openCodeModal(result.challenge, "reset-verify", ()=>{
          authState = {hasPassword:true, authenticated:true};
          state.editing = true; render();
          showToast("Password reset — you're logged in.");
        });
      }
    });
  }
  function openChangePasswordModal(){
    openFormModal({
      title:"Change edit password",
      sub:"You'll need a verification code from your email to confirm this change.",
      fields:[
        {name:"current", label:"Current password", type:"password", required:true},
        {name:"next", label:"New password", type:"password", required:true},
        {name:"next2", label:"Confirm new password", type:"password", required:true}
      ],
      submitLabel:"Send verification code",
      onSubmit:async(v)=>{
        if(v.next !== v.next2){ showToast("New passwords don't match.", true); return; }
        if(v.next.length < 4){ showToast("Use at least 4 characters.", true); return; }
        const result = await callAuthApi({action:"change-request", currentPassword:v.current, newPassword:v.next});
        if(!result.ok){ showToast(result.error || "Couldn't start the password change.", true); return; }
        showToast("Verification code sent to your email");
        openCodeModal(result.challenge, "change-verify", ()=>{
          showToast("Password updated");
        });
      }
    });
  }
  async function logout(){
    await callAuthApi({action:"logout"});
    authState.authenticated = false;
    state.editing = false;
    render();
  }

  /* ============ Profile modal ============ */
  function openProfileModal(){
    const p = data.profile;
    openFormModal({
      title:"Edit intro",
      fields:[
        {name:"name", label:"Name", value:p.name, required:true},
        {name:"title", label:"Title / tagline", value:p.title, placeholder:"e.g. Frontend developer & photographer"},
        {name:"description", label:"Short description", type:"textarea", value:p.description}
      ],
      submitLabel:"Save",
      onSubmit:(v)=>{ p.name=v.name; p.title=v.title; p.description=v.description; persistAndRender(); }
    });
  }

  /* ============ Socials editor ============ */
  /* ============ Profiles ============ */
  let mpEditingId = null;
  function openManageProfilesModal(){ mpEditingId = null; renderManageProfilesModal(); }
  function renderManageProfilesModal(){
    const rows = data.profiles.map(p=>{
      const isActive = p.id === data.activeProfileId;
      if(mpEditingId === p.id){
        return `<div class="subrow" style="margin-bottom:9px;">
          <div class="field" style="margin-bottom:8px;"><label>Profile name</label><input id="mp_rename_input" value="${esc(p.name)}"></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" type="button" data-action="mp-rename-save" data-id="${p.id}">Save</button>
            <button class="btn ghost sm" type="button" data-action="mp-rename-cancel">Cancel</button>
          </div>
        </div>`;
      }
      return `<div class="subrow-list-item"><span>${esc(p.name)} ${isActive?'<span class="meta">viewing now</span>':''}</span>
        <span style="display:flex; gap:10px; flex-shrink:0; flex-wrap:wrap;">
          ${!isActive?`<button class="textlink" data-id="${p.id}" data-action="mp-activate">View this</button>`:''}
          <button class="textlink" data-id="${p.id}" data-action="mp-rename-start">Rename</button>
          ${data.profiles.length>1?`<button class="textlink danger" data-id="${p.id}" data-action="mp-delete">Delete</button>`:''}
        </span></div>`;
    }).join("");

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Profiles</h3>
        <div class="modal-sub">Different named setups for your portfolio — e.g. a "School Profile" that only shows some sections. Every profile shares the same underlying content and files; nothing gets duplicated, they just show, hide, and order sections differently. Whichever one you're viewing is what every visitor sees.</div>
        ${rows}
        <div class="subrow">
          <div class="field" style="margin-bottom:8px;"><label>New profile name</label><input id="mp_name" placeholder="e.g. School Profile"></div>
          <button class="btn ghost sm" type="button" data-action="mp-add">+ Add profile</button>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn accent" data-action="modal-cancel">Done</button>
        </div>
      </div>
    </div>`;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });

    modalRoot.querySelectorAll('[data-action="mp-activate"]').forEach(btn=>{
      btn.onclick = ()=>{ data.activeProfileId = btn.dataset.id; persistAndRender(); renderManageProfilesModal(); };
    });
    modalRoot.querySelectorAll('[data-action="mp-rename-start"]').forEach(btn=>{
      btn.onclick = ()=>{ mpEditingId = btn.dataset.id; renderManageProfilesModal(); };
    });
    const cancelBtn = modalRoot.querySelector('[data-action="mp-rename-cancel"]');
    if(cancelBtn){ cancelBtn.onclick = ()=>{ mpEditingId = null; renderManageProfilesModal(); }; }
    const saveBtn = modalRoot.querySelector('[data-action="mp-rename-save"]');
    if(saveBtn){
      saveBtn.onclick = ()=>{
        const p = data.profiles.find(x=>x.id===saveBtn.dataset.id);
        const name = document.getElementById("mp_rename_input").value.trim();
        if(!name){ showToast("Give it a name.", true); return; }
        if(p) p.name = name;
        mpEditingId = null;
        persistAndRender();
        renderManageProfilesModal();
      };
    }
    modalRoot.querySelectorAll('[data-action="mp-delete"]').forEach(btn=>{
      btn.onclick = ()=>{
        if(data.profiles.length<=1){ showToast("You need at least one profile.", true); return; }
        const idx = data.profiles.findIndex(x=>x.id===btn.dataset.id);
        if(idx<0) return;
        const wasActive = data.profiles[idx].id === data.activeProfileId;
        data.profiles.splice(idx,1);
        if(wasActive) data.activeProfileId = data.profiles[0].id;
        persistAndRender();
        renderManageProfilesModal();
      };
    });
    modalRoot.querySelector('[data-action="mp-add"]').onclick = ()=>{
      const name = document.getElementById("mp_name").value.trim();
      if(!name){ showToast("Give the new profile a name.", true); return; }
      // The very first time a second profile is created, every existing
      // entry needs to be explicitly pinned to the profile(s) that already
      // exist — otherwise, once there's more than one profile, "unassigned"
      // starts meaning "not in any profile" and everything you've already
      // built would vanish. This is a one-time snapshot; the brand new
      // profile's id is deliberately left out of it, so it starts empty.
      if(data.profiles.length === 1){
        const existingIds = data.profiles.map(p=>p.id);
        const stamp = (list)=>{ (list||[]).forEach(item=>{ if(!item.profileIds || item.profileIds.length===0) item.profileIds = [...existingIds]; }); };
        stamp(data.achievements);
        stamp(data.education);
        stamp(data.skills);
        (data.experience||[]).forEach(sec=>stamp(sec.items));
        (data.projectCategories||[]).forEach(cat=>stamp(cat.projects));
        (data.customSections||[]).forEach(cs=>stamp(cs.items));
      }
      const activeP = getActiveProfile();
      const newProfile = {
        id: uid(), name,
        hiddenSections: [...activeP.hiddenSections],
        sectionOrder: [...activeP.sectionOrder]
      };
      data.profiles.push(newProfile);
      data.activeProfileId = newProfile.id;
      persistAndRender();
      renderManageProfilesModal();
      showToast(`"${name}" created — it starts empty. Add new entries, or use "Browse existing" in each section to reuse ones you already have.`);
    };
  }

  let tempSocials = null;
  let tempSocialsEditIdx = null;
  function openSocialsModal(){ tempSocials = structuredClone(data.profile.socials || []); tempSocialsEditIdx = null; renderSocialsModal(); }
  function renderSocialsModal(){
    let rows = tempSocials.map((s,i)=>`
      <div class="subrow-list-item" style="${i===tempSocialsEditIdx?'border-color:var(--accent);':''}"><span>${esc(s.label)} <span class="meta">${esc(s.url)}</span></span>
      <span style="display:flex; gap:10px; flex-shrink:0;">
        <button class="textlink" data-idx="${i}" data-action="soc-edit">${i===tempSocialsEditIdx?'Editing…':'Edit'}</button>
        <button class="textlink danger" data-idx="${i}" data-action="soc-remove">Remove</button>
      </span></div>`).join("");
    if(!rows) rows = `<div class="hint" style="margin:0 0 10px;">No links yet — add as many as you like below.</div>`;
    const typeOptions = SOCIAL_TYPES.map(t=>`<option value="${t}">${t}</option>`).join("");
    const editing = tempSocialsEditIdx !== null;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Edit links</h3>
        <div class="modal-sub">Add links to GitHub, LinkedIn, a personal site, a resume, or anywhere else people can find you — add as many as you like.</div>
        ${rows}
        <div class="subrow">
          ${editing?'<div class="hint" style="margin-top:0;">Editing an existing link — update the fields and save, or cancel to leave it unchanged.</div>':''}
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Type</label><select id="soc_type">${typeOptions}</select></div>
            <div class="field" style="margin-bottom:0;"><label>Label</label><input id="soc_label" placeholder="e.g. GitHub"></div>
          </div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="soc_url" placeholder="https://..."></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" data-action="soc-add" type="button">${editing ? "Save edited link" : "+ Add link"}</button>
            ${editing?'<button class="btn ghost sm" data-action="soc-cancel-edit" type="button">Cancel edit</button>':''}
          </div>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="soc-save">Save all</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="soc-remove"]').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = +btn.dataset.idx;
        tempSocials.splice(idx,1);
        if(tempSocialsEditIdx===idx) tempSocialsEditIdx = null;
        else if(tempSocialsEditIdx!==null && idx<tempSocialsEditIdx) tempSocialsEditIdx--;
        renderSocialsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="soc-edit"]').forEach(btn=>{
      btn.onclick = ()=>{ tempSocialsEditIdx = +btn.dataset.idx; renderSocialsModal(); };
    });
    const cancelEditBtn = modalRoot.querySelector('[data-action="soc-cancel-edit"]');
    if(cancelEditBtn){ cancelEditBtn.onclick = ()=>{ tempSocialsEditIdx = null; renderSocialsModal(); }; }
    if(editing){
      const s = tempSocials[tempSocialsEditIdx];
      document.getElementById("soc_type").value = s.type || "other";
      document.getElementById("soc_label").value = s.label || "";
      document.getElementById("soc_url").value = s.url || "";
    }
    modalRoot.querySelector('[data-action="soc-add"]').onclick = ()=>{
      const type = document.getElementById("soc_type").value;
      const label = document.getElementById("soc_label").value.trim();
      const url = document.getElementById("soc_url").value.trim();
      if(!label || !url){ showToast("Add a label and a URL.", true); return; }
      if(editing){
        tempSocials[tempSocialsEditIdx] = Object.assign({}, tempSocials[tempSocialsEditIdx], {type, label, url});
        tempSocialsEditIdx = null;
      } else {
        tempSocials.push({id:uid(), type, label, url});
      }
      renderSocialsModal();
    };
    modalRoot.querySelector('[data-action="soc-save"]').onclick = ()=>{ data.profile.socials = tempSocials; persistAndRender(); closeModal(); };
  }

  /* ============ Achievements / Education ============ */
  let tempRecord = null;
  let tempRecordKind = null;
  function openRecordModal(kind, id){
    tempRecordKind = kind;
    const list = kind === "achievement" ? data.achievements : data.education;
    const existing = id ? list.find(x=>x.id===id) : null;
    tempRecord = existing ? structuredClone(existing) : {id:uid(), title:"", org:"", date:"", description:"", certLink:"", certImage:"", certFileLabel:"", certFileUrl:"", profileIds: defaultProfileIds()};
    renderRecordModal(!!existing);
  }
  function renderRecordModal(isEdit){
    const kind = tempRecordKind;
    const r = tempRecord;
    const titleLabel = kind==="achievement" ? "Title" : "Degree / Program";
    const orgLabel = kind==="achievement" ? "Organization" : "School";

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${isEdit ? `Edit ${kind}` : `Add ${kind}`}</h3>
        <div class="field"><label>${titleLabel} *</label><input id="rec_title" value="${esc(r.title)}"></div>
        <div class="field"><label>${orgLabel}</label><input id="rec_org" value="${esc(r.org)}"></div>
        <div class="field"><label>Date</label><input id="rec_date" value="${esc(r.date)}" placeholder="e.g. 2023 or 2020 – 2024"></div>
        <div class="field"><label>Description</label><textarea id="rec_desc">${esc(r.description)}</textarea></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Additional Links (optional)</h3></div>
        <div class="hint" style="margin-top:-2px;">Attach any combination of a link, a photo, and/or a file. Visitors can expand this entry to view them — nothing else changes in the normal view.</div>

        <div class="field"><label>Link</label><input id="rec_cert_link" value="${esc(r.certLink||'')}" placeholder="https://..."></div>

        ${r.certImage ? `<div class="subrow-list-item"><span>Photo attached</span><button class="textlink danger" type="button" data-action="rec-remove-photo">Remove photo</button></div>` : ''}
        <div class="field"><label>${r.certImage?'Replace photo':'Upload photo'}</label><input type="file" id="rec_cert_file" accept="image/*"></div>
        <div class="field"><label>Or paste an image URL</label><input id="rec_cert_url" placeholder="https://..."></div>
        <button class="btn ghost sm" type="button" data-action="rec-browse-photo" style="margin-bottom:12px;">Browse library</button>

        ${r.certFileUrl ? `<div class="subrow-list-item"><span>File attached${r.certFileLabel?': '+esc(r.certFileLabel):''}</span><button class="textlink danger" type="button" data-action="rec-remove-file">Remove file</button></div>` : ''}
        <div class="field"><label>File label (optional)</label><input id="rec_cert_file_label" value="${esc(r.certFileLabel||'')}" placeholder="e.g. Document.pdf"></div>
        <div class="field"><label>${r.certFileUrl?'Replace file':'Upload a file'}</label><input type="file" id="rec_cert_file_upload"></div>
        <div class="field"><label>Or paste a file URL</label><input id="rec_cert_file_url" placeholder="Link to a downloadable file"></div>
        <button class="btn ghost sm" type="button" data-action="rec-browse-file">Browse library</button>

        ${profileScopeFieldHtml(r, "rec_profile_scope")}

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="rec-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="rec-save">${isEdit ? "Save changes" : "Add"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    const removeBtn = modalRoot.querySelector('[data-action="rec-remove-photo"]');
    if(removeBtn){ removeBtn.onclick = ()=>{ syncRecordFields(); r.certImage=""; renderRecordModal(isEdit); }; }
    const removeFileBtn = modalRoot.querySelector('[data-action="rec-remove-file"]');
    if(removeFileBtn){ removeFileBtn.onclick = ()=>{ syncRecordFields(); r.certFileUrl=""; r.certFileLabel=""; renderRecordModal(isEdit); }; }
    modalRoot.querySelector('[data-action="rec-browse-photo"]').onclick = ()=>{
      syncRecordFields();
      openMediaLibraryModal((url)=>{ r.certImage = url; renderRecordModal(isEdit); }, true);
    };
    modalRoot.querySelector('[data-action="rec-browse-file"]').onclick = ()=>{
      syncRecordFields();
      openMediaLibraryModal((url, name)=>{
        r.certFileUrl = url;
        if(!r.certFileLabel) r.certFileLabel = name;
        renderRecordModal(isEdit);
      }, false);
    };
    if(isEdit){
      modalRoot.querySelector('[data-action="rec-delete"]').onclick = ()=>{ deleteRecord(kind, r.id); closeModal(); };
    }
    modalRoot.querySelector('[data-action="rec-save"]').onclick = async ()=>{
      syncRecordFields();
      if(!r.title){ showToast("This needs a title.", true); return; }
      const saveBtn = modalRoot.querySelector('[data-action="rec-save"]');
      const photoInput = document.getElementById("rec_cert_file");
      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      const fileInput = document.getElementById("rec_cert_file_upload");
      const attachedFile = fileInput && fileInput.files && fileInput.files[0];
      if(photoFile || attachedFile){ saveBtn.disabled = true; saveBtn.textContent = "Uploading…"; }
      if(photoFile){
        try{ r.certImage = await uploadImageFile(photoFile, 1400, 0.88); }
        catch(err){ showToast(err.message || "Couldn't upload that image.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      if(attachedFile){
        try{
          r.certFileUrl = await uploadRawFile(attachedFile);
          if(!r.certFileLabel) r.certFileLabel = attachedFile.name;
        }catch(err){ showToast(err.message || "Couldn't upload that file.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      const list = kind === "achievement" ? data.achievements : data.education;
      const idx = list.findIndex(x=>x.id===r.id);
      if(idx>-1){ list[idx] = r; } else { list.push(r); }
      persistAndRender(); closeModal();
    };
  }
  function syncRecordFields(){
    const r = tempRecord;
    r.title = document.getElementById("rec_title").value.trim();
    r.org = document.getElementById("rec_org").value.trim();
    r.date = document.getElementById("rec_date").value.trim();
    r.description = document.getElementById("rec_desc").value.trim();
    r.certLink = document.getElementById("rec_cert_link").value.trim();
    const urlEl = document.getElementById("rec_cert_url");
    if(urlEl && urlEl.value.trim()) r.certImage = urlEl.value.trim();
    r.certFileLabel = document.getElementById("rec_cert_file_label").value.trim();
    const fileUrlEl = document.getElementById("rec_cert_file_url");
    if(fileUrlEl && fileUrlEl.value.trim()) r.certFileUrl = fileUrlEl.value.trim();
    applyProfileScopeField(r, "rec_profile_scope");
  }
  function deleteRecord(kind, id){
    const list = kind === "achievement" ? data.achievements : data.education;
    const idx = list.findIndex(x=>x.id===id);
    if(idx>-1) list.splice(idx,1);
    persistAndRender();
  }

  /* ============ Skills ============ */
  function openSkillModal(id){
    const existing = id ? data.skills.find(x=>x.id===id) : null;
    const fields = [
      {name:"category", label:"Category name", value:existing?existing.category:"", placeholder:"e.g. Languages", required:true},
      {name:"items", label:"Skills (comma-separated)", type:"textarea", value:existing?(existing.items||[]).join(", "):"", placeholder:"e.g. JavaScript, Python, SQL"}
    ];
    if(data.profiles && data.profiles.length > 1){
      const allIds = data.profiles.map(p=>p.id);
      const checked = !!(existing && existing.profileIds && allIds.every(pid=>existing.profileIds.includes(pid)));
      fields.push({name:"allProfiles", type:"checkbox", label:"Show in all profiles", checked});
    }
    openFormModal({
      title: existing ? "Edit skill category" : "Add skill category",
      sub:"List skills separated by commas.",
      fields,
      submitLabel: existing ? "Save changes" : "Add",
      onDelete: existing ? ()=>{ const idx=data.skills.findIndex(x=>x.id===id); if(idx>-1) data.skills.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        const items = v.items.split(",").map(s=>s.trim()).filter(Boolean);
        const profileIds = ("allProfiles" in v) ? (v.allProfiles ? data.profiles.map(p=>p.id) : [getActiveProfile().id]) : (existing ? existing.profileIds : defaultProfileIds());
        if(existing){ existing.category=v.category; existing.items=items; existing.profileIds=profileIds; }
        else { data.skills.push({id:uid(), category:v.category, items, profileIds}); }
        persistAndRender();
      }
    });
  }

  /* ============ Experience ============ */
  function openExpSectionModal(id){
    const existing = id ? data.experience.find(x=>x.id===id) : null;
    openFormModal({
      title: existing ? "Rename section" : "Add experience section",
      fields:[{name:"sectionTitle", label:"Section title", value:existing?existing.sectionTitle:"", placeholder:"e.g. Work Experience", required:true}],
      submitLabel: existing ? "Save" : "Add section",
      onDelete: existing ? ()=>{ const idx=data.experience.findIndex(x=>x.id===id); if(idx>-1) data.experience.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        if(existing){ existing.sectionTitle = v.sectionTitle; } else { data.experience.push({id:uid(), sectionTitle:v.sectionTitle, items:[]}); }
        persistAndRender();
      }
    });
  }
  function openExpItemModal(sectionId, itemId){
    const sec = data.experience.find(s=>s.id===sectionId);
    if(!sec) return;
    const existing = itemId ? sec.items.find(i=>i.id===itemId) : null;
    const fields = [
      {name:"title", label:"Title", value:existing?existing.title:"", placeholder:"e.g. Job title or role", required:true},
      {name:"subtitle", label:"Subtitle", value:existing?existing.subtitle:"", placeholder:"e.g. Company or organization"},
      {name:"date", label:"Date", value:existing?existing.date:"", placeholder:"e.g. 2023 – Present"},
      {name:"description", label:"Description", type:"textarea", value:existing?existing.description:""}
    ];
    if(data.profiles && data.profiles.length > 1){
      const allIds = data.profiles.map(p=>p.id);
      const checked = !!(existing && existing.profileIds && allIds.every(pid=>existing.profileIds.includes(pid)));
      fields.push({name:"allProfiles", type:"checkbox", label:"Show in all profiles", checked});
    }
    openFormModal({
      title: existing ? "Edit item" : `Add item to "${sec.sectionTitle}"`,
      fields,
      submitLabel: existing ? "Save changes" : "Add",
      onDelete: existing ? ()=>{ const idx=sec.items.findIndex(i=>i.id===itemId); if(idx>-1) sec.items.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        const hasToggle = "allProfiles" in v;
        const profileIds = hasToggle ? (v.allProfiles ? data.profiles.map(p=>p.id) : [getActiveProfile().id]) : null;
        delete v.allProfiles;
        if(existing){ Object.assign(existing, v); if(profileIds) existing.profileIds = profileIds; }
        else { sec.items.push({id:uid(), ...v, profileIds: profileIds || defaultProfileIds()}); }
        persistAndRender();
      }
    });
  }

  /* ============ Custom sections ============ */
  function openAddSectionModal(){
    openFormModal({
      title:"Add a new section",
      sub:"Give it a name — you can add an intro, a list, and entries inside it once it's created.",
      fields:[{name:"title", label:"Section title", placeholder:"e.g. Certifications, Hobbies, Publications", required:true}],
      submitLabel:"Create section",
      onSubmit:(v)=>{
        const cs = {id:uid(), title:v.title, intro:"", bullets:[], items:[]};
        data.customSections.push(cs);
        state.section = "custom:"+cs.id;
        persistAndRender();
      }
    });
  }
  function openRenameSectionModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Rename section",
      fields:[{name:"title", label:"Section title", value:cs.title, required:true}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.title=v.title; persistAndRender(); }
    });
  }
  function deleteCustomSection(id){
    const idx = data.customSections.findIndex(c=>c.id===id);
    if(idx>-1) data.customSections.splice(idx,1);
    if(state.section === "custom:"+id) state.section = "home";
    persistAndRender();
  }
  function openSectionIntroModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Edit intro text",
      fields:[{name:"intro", label:"Intro", type:"textarea", value:cs.intro||""}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.intro=v.intro; persistAndRender(); }
    });
  }
  function openSectionBulletsModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Edit list",
      sub:"One item per line — good for a simple bulleted list.",
      fields:[{name:"bullets", label:"List items", type:"textarea", value:(cs.bullets||[]).join("\n")}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.bullets = v.bullets.split("\n").map(s=>s.trim()).filter(Boolean); persistAndRender(); }
    });
  }
  let tempSectionItem = null;
  let tempSectionItemParentId = null;
  function openSectionItemModal(sectionId, itemId){
    const cs = data.customSections.find(c=>c.id===sectionId);
    if(!cs) return;
    tempSectionItemParentId = sectionId;
    const existing = itemId ? cs.items.find(i=>i.id===itemId) : null;
    tempSectionItem = existing ? structuredClone(existing) : {id:uid(), title:"", subtitle:"", date:"", description:"", certLink:"", certImage:"", certFileLabel:"", certFileUrl:"", profileIds: defaultProfileIds()};
    renderSectionItemModal(!!existing);
  }
  function renderSectionItemModal(isEdit){
    const r = tempSectionItem;
    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${isEdit ? "Edit entry" : "Add entry"}</h3>
        <div class="field"><label>Title *</label><input id="si_title" value="${esc(r.title)}"></div>
        <div class="field"><label>Subtitle</label><input id="si_subtitle" value="${esc(r.subtitle)}"></div>
        <div class="field"><label>Date</label><input id="si_date" value="${esc(r.date)}"></div>
        <div class="field"><label>Description</label><textarea id="si_desc">${esc(r.description)}</textarea></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Additional Links (optional)</h3></div>
        <div class="hint" style="margin-top:-2px;">Attach any combination of a link, a photo, and/or a file. Visitors can expand this entry to view them — nothing else changes in the normal view.</div>

        <div class="field"><label>Link</label><input id="si_cert_link" value="${esc(r.certLink||'')}" placeholder="https://..."></div>

        ${r.certImage ? `<div class="subrow-list-item"><span>Photo attached</span><button class="textlink danger" type="button" data-action="si-remove-photo">Remove photo</button></div>` : ''}
        <div class="field"><label>${r.certImage?'Replace photo':'Upload photo'}</label><input type="file" id="si_cert_file" accept="image/*"></div>
        <div class="field"><label>Or paste an image URL</label><input id="si_cert_url" placeholder="https://..."></div>
        <button class="btn ghost sm" type="button" data-action="si-browse-photo" style="margin-bottom:12px;">Browse library</button>

        ${r.certFileUrl ? `<div class="subrow-list-item"><span>File attached${r.certFileLabel?': '+esc(r.certFileLabel):''}</span><button class="textlink danger" type="button" data-action="si-remove-file">Remove file</button></div>` : ''}
        <div class="field"><label>File label (optional)</label><input id="si_cert_file_label" value="${esc(r.certFileLabel||'')}" placeholder="e.g. Document.pdf"></div>
        <div class="field"><label>${r.certFileUrl?'Replace file':'Upload a file'}</label><input type="file" id="si_cert_file_upload"></div>
        <div class="field"><label>Or paste a file URL</label><input id="si_cert_file_url" placeholder="Link to a downloadable file"></div>
        <button class="btn ghost sm" type="button" data-action="si-browse-file">Browse library</button>

        ${profileScopeFieldHtml(r, "si_profile_scope")}

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="si-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="si-save">${isEdit ? "Save changes" : "Add"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    const removeBtn = modalRoot.querySelector('[data-action="si-remove-photo"]');
    if(removeBtn){ removeBtn.onclick = ()=>{ syncSectionItemFields(); r.certImage=""; renderSectionItemModal(isEdit); }; }
    const removeFileBtn = modalRoot.querySelector('[data-action="si-remove-file"]');
    if(removeFileBtn){ removeFileBtn.onclick = ()=>{ syncSectionItemFields(); r.certFileUrl=""; r.certFileLabel=""; renderSectionItemModal(isEdit); }; }
    modalRoot.querySelector('[data-action="si-browse-photo"]').onclick = ()=>{
      syncSectionItemFields();
      openMediaLibraryModal((url)=>{ r.certImage = url; renderSectionItemModal(isEdit); }, true);
    };
    modalRoot.querySelector('[data-action="si-browse-file"]').onclick = ()=>{
      syncSectionItemFields();
      openMediaLibraryModal((url, name)=>{
        r.certFileUrl = url;
        if(!r.certFileLabel) r.certFileLabel = name;
        renderSectionItemModal(isEdit);
      }, false);
    };
    if(isEdit){
      modalRoot.querySelector('[data-action="si-delete"]').onclick = ()=>{
        const cs = data.customSections.find(c=>c.id===tempSectionItemParentId);
        if(cs){ const idx=cs.items.findIndex(i=>i.id===r.id); if(idx>-1) cs.items.splice(idx,1); }
        persistAndRender(); closeModal();
      };
    }
    modalRoot.querySelector('[data-action="si-save"]').onclick = async ()=>{
      syncSectionItemFields();
      if(!r.title){ showToast("This needs a title.", true); return; }
      const saveBtn = modalRoot.querySelector('[data-action="si-save"]');
      const photoInput = document.getElementById("si_cert_file");
      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      const fileInput = document.getElementById("si_cert_file_upload");
      const attachedFile = fileInput && fileInput.files && fileInput.files[0];
      if(photoFile || attachedFile){ saveBtn.disabled = true; saveBtn.textContent = "Uploading…"; }
      if(photoFile){
        try{ r.certImage = await uploadImageFile(photoFile, 1400, 0.88); }
        catch(err){ showToast(err.message || "Couldn't upload that image.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      if(attachedFile){
        try{
          r.certFileUrl = await uploadRawFile(attachedFile);
          if(!r.certFileLabel) r.certFileLabel = attachedFile.name;
        }catch(err){ showToast(err.message || "Couldn't upload that file.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      const cs = data.customSections.find(c=>c.id===tempSectionItemParentId);
      if(!cs){ showToast("That section no longer exists.", true); return; }
      const idx = cs.items.findIndex(i=>i.id===r.id);
      if(idx>-1){ cs.items[idx] = r; } else { cs.items.push(r); }
      persistAndRender(); closeModal();
    };
  }
  function syncSectionItemFields(){
    const r = tempSectionItem;
    r.title = document.getElementById("si_title").value.trim();
    r.subtitle = document.getElementById("si_subtitle").value.trim();
    r.date = document.getElementById("si_date").value.trim();
    r.description = document.getElementById("si_desc").value.trim();
    r.certLink = document.getElementById("si_cert_link").value.trim();
    const urlEl = document.getElementById("si_cert_url");
    if(urlEl && urlEl.value.trim()) r.certImage = urlEl.value.trim();
    r.certFileLabel = document.getElementById("si_cert_file_label").value.trim();
    const fileUrlEl = document.getElementById("si_cert_file_url");
    if(fileUrlEl && fileUrlEl.value.trim()) r.certFileUrl = fileUrlEl.value.trim();
    applyProfileScopeField(r, "si_profile_scope");
  }

  /* ============ Manage sections ============ */
  function openManageSectionsModal(){ renderManageSectionsModal(); }
  function renderManageSectionsModal(){
    const viewProfile = getActiveProfile();
    ensureSectionOrder(viewProfile);
    const order = viewProfile.sectionOrder;
    const rows = order.map((key, idx)=>{
      let label, isCustom = key.startsWith("custom:"), hidden = false;
      if(isCustom){
        const cs = data.customSections.find(c=>c.id===key.slice(7));
        if(!cs) return "";
        label = cs.title;
      } else {
        const fs = FIXED_SECTIONS.find(s=>s.key===key);
        if(!fs) return "";
        label = fs.label;
        hidden = viewProfile.hiddenSections.includes(key);
      }
      const isFirst = idx===0, isLast = idx===order.length-1;
      const tag = isCustom ? '<span class="meta">custom</span>' : (hidden ? '<span class="meta">hidden</span>' : '<span class="meta">visible</span>');
      let controls = `<button class="textlink" data-idx="${idx}" data-action="ms-move-up" ${isFirst?'disabled':''} style="${isFirst?'opacity:.3;':''}">↑</button>
        <button class="textlink" data-idx="${idx}" data-action="ms-move-down" ${isLast?'disabled':''} style="${isLast?'opacity:.3;':''}">↓</button>`;
      if(!isCustom && key!=="home"){
        controls += `<button class="textlink" data-key="${key}" data-action="toggle-hide-section">${hidden?"Show":"Hide"}</button>`;
      }
      if(isCustom){
        controls += `<button class="textlink danger" data-id="${key.slice(7)}" data-action="ms-delete-custom">Delete</button>`;
      }
      return `<div class="subrow-list-item"><span>${esc(label)} ${tag}</span>
        <span style="display:flex; gap:10px; flex-shrink:0; align-items:center;">${controls}</span></div>`;
    }).join("");

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Manage sections</h3>
        <div class="modal-sub">Editing the <strong>${esc(viewProfile.name)}</strong> profile. Reorder tabs with the arrows, hide built-in sections you don't need, or remove custom ones. Switch profiles from "Viewing: ${esc(viewProfile.name)}" in the edit bar.</div>
        ${rows}
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn accent" data-action="modal-cancel">Done</button>
        </div>
      </div>
    </div>`;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="toggle-hide-section"]').forEach(btn=>{
      btn.onclick = ()=>{
        const key = btn.dataset.key;
        const idx = viewProfile.hiddenSections.indexOf(key);
        if(idx>-1){ viewProfile.hiddenSections.splice(idx,1); } else { viewProfile.hiddenSections.push(key); }
        saveData();
        renderManageSectionsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="ms-delete-custom"]').forEach(btn=>{
      btn.onclick = ()=>{ deleteCustomSection(btn.dataset.id); renderManageSectionsModal(); };
    });
    modalRoot.querySelectorAll('[data-action="ms-move-up"]').forEach(btn=>{
      btn.onclick = ()=>{
        if(btn.disabled) return;
        const idx = +btn.dataset.idx;
        if(idx<=0) return;
        const arr = viewProfile.sectionOrder;
        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
        saveData();
        renderManageSectionsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="ms-move-down"]').forEach(btn=>{
      btn.onclick = ()=>{
        if(btn.disabled) return;
        const idx = +btn.dataset.idx;
        if(idx>=viewProfile.sectionOrder.length-1) return;
        const arr = viewProfile.sectionOrder;
        [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
        saveData();
        renderManageSectionsModal();
      };
    });
  }

  /* ============ Contact ============ */
  function openContactModal(){
    const c = Object.assign({email:"",phone:"",location:"",availability:"",preferred:"",resumeUrl:"",blurb:"",links:[]}, data.contact||{});
    openFormModal({
      title:"Edit contact",
      fields:[
        {name:"email", label:"Email address", value:c.email, placeholder:"you@example.com", required:true},
        {name:"phone", label:"Phone (optional)", value:c.phone, placeholder:"+63 900 000 0000"},
        {name:"location", label:"Location (optional)", value:c.location, placeholder:"e.g. Cebu City, Philippines"},
        {name:"availability", label:"Availability (optional)", value:c.availability, placeholder:"e.g. Open to freelance work"},
        {name:"preferred", label:"Preferred contact method (optional)", value:c.preferred, placeholder:"e.g. Email works best"},
        {name:"resumeUrl", label:"Résumé link (optional)", value:c.resumeUrl, placeholder:"Link to a downloadable résumé"},
        {name:"blurb", label:"Short note (optional)", type:"textarea", value:c.blurb}
      ],
      submitLabel:"Save",
      onSubmit:(v)=>{ data.contact = Object.assign({}, data.contact, v); persistAndRender(); }
    });
  }

  /* ============ Contact links editor ============ */
  let tempContactLinks = null;
  let tempContactLinksEditIdx = null;
  function openContactLinksModal(){
    if(!data.contact.links) data.contact.links = [];
    tempContactLinks = structuredClone(data.contact.links);
    tempContactLinksEditIdx = null;
    renderContactLinksModal();
  }
  function renderContactLinksModal(){
    let rows = tempContactLinks.map((l,i)=>`
      <div class="subrow-list-item" style="${i===tempContactLinksEditIdx?'border-color:var(--accent);':''}"><span>${esc(l.label)} <span class="meta">${esc(l.url)}</span></span>
      <span style="display:flex; gap:10px; flex-shrink:0;">
        <button class="textlink" data-idx="${i}" data-action="cl-edit">${i===tempContactLinksEditIdx?'Editing…':'Edit'}</button>
        <button class="textlink danger" data-idx="${i}" data-action="cl-remove">Remove</button>
      </span></div>`).join("");
    if(!rows) rows = `<div class="hint" style="margin:0 0 10px;">No links yet — add as many as you like below.</div>`;
    const editing = tempContactLinksEditIdx !== null;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Additional contact links</h3>
        <div class="modal-sub">Add any extra links you'd like visitors to find here — a scheduling page, WhatsApp, Discord, anything you prefer.</div>
        ${rows}
        <div class="subrow">
          ${editing?'<div class="hint" style="margin-top:0;">Editing an existing link — update the fields and save, or cancel to leave it unchanged.</div>':''}
          <div class="field" style="margin-bottom:8px;"><label>Label</label><input id="cl_label" placeholder="e.g. Book a call"></div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="cl_url" placeholder="https://..."></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" data-action="cl-add" type="button">${editing ? "Save edited link" : "+ Add link"}</button>
            ${editing?'<button class="btn ghost sm" data-action="cl-cancel-edit" type="button">Cancel edit</button>':''}
          </div>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="cl-save">Save all</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="cl-remove"]').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = +btn.dataset.idx;
        tempContactLinks.splice(idx,1);
        if(tempContactLinksEditIdx===idx) tempContactLinksEditIdx = null;
        else if(tempContactLinksEditIdx!==null && idx<tempContactLinksEditIdx) tempContactLinksEditIdx--;
        renderContactLinksModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="cl-edit"]').forEach(btn=>{
      btn.onclick = ()=>{ tempContactLinksEditIdx = +btn.dataset.idx; renderContactLinksModal(); };
    });
    const cancelEditBtn = modalRoot.querySelector('[data-action="cl-cancel-edit"]');
    if(cancelEditBtn){ cancelEditBtn.onclick = ()=>{ tempContactLinksEditIdx = null; renderContactLinksModal(); }; }
    if(editing){
      const l = tempContactLinks[tempContactLinksEditIdx];
      document.getElementById("cl_label").value = l.label || "";
      document.getElementById("cl_url").value = l.url || "";
    }
    modalRoot.querySelector('[data-action="cl-add"]').onclick = ()=>{
      const label = document.getElementById("cl_label").value.trim();
      const url = document.getElementById("cl_url").value.trim();
      if(!label || !url){ showToast("Add a label and a URL.", true); return; }
      if(editing){
        tempContactLinks[tempContactLinksEditIdx] = Object.assign({}, tempContactLinks[tempContactLinksEditIdx], {label, url});
        tempContactLinksEditIdx = null;
      } else {
        tempContactLinks.push({id:uid(), label, url});
      }
      renderContactLinksModal();
    };
    modalRoot.querySelector('[data-action="cl-save"]').onclick = ()=>{ data.contact.links = tempContactLinks; persistAndRender(); closeModal(); };
  }

  /* ============ Project categories ============ */
  function openProjectCategoryModal(id){
    const existing = id ? data.projectCategories.find(c=>c.id===id) : null;
    openFormModal({
      title: existing ? "Rename category" : "Add project category",
      fields:[{name:"title", label:"Category name", value:existing?existing.title:"", placeholder:"e.g. Web Apps, Client Work", required:true}],
      submitLabel: existing ? "Save" : "Add category",
      onDelete: existing ? ()=>{ const idx=data.projectCategories.findIndex(x=>x.id===id); if(idx>-1) data.projectCategories.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        if(existing){ existing.title = v.title; } else { data.projectCategories.push({id:uid(), title:v.title, projects:[]}); }
        persistAndRender();
      }
    });
  }

  /* ============ Project editor ============ */
  let tempProject = null;
  let tempProjectCategoryId = null;
  function openProjectModal(categoryId, id){
    tempProjectCategoryId = categoryId;
    const cat = data.projectCategories.find(c=>c.id===categoryId);
    const existing = (id && cat) ? cat.projects.find(p=>p.id===id) : null;
    tempProject = existing ? structuredClone(existing) : {id:uid(), header:"", description:"", tags:[], links:[], files:[], images:[], profileIds: defaultProfileIds()};
    renderProjectModal(!!existing);
  }
  function renderProjectModal(isEdit){
    const p = tempProject;
    const linkRows = (p.links||[]).map((l,i)=>`
      <div class="subrow-list-item"><span>[${esc(l.type)}] ${esc(l.label)} <span class="meta">${esc(l.url)}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="link-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No links yet.</div>`;
    const fileRows = (p.files||[]).map((f,i)=>`
      <div class="subrow-list-item"><span>${esc(f.label)} <span class="meta">${esc(f.url)}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="file-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No downloadable files yet.</div>`;
    const imageRows = (p.images||[]).map((im,i)=>`
      <div class="subrow-list-item"><span>${esc(im.caption||"(no caption)")} <span class="meta">${esc(im.url).slice(0,40)}${im.url.length>40?'…':''}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="image-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No photos yet.</div>`;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true" style="max-width:600px;">
        <h3>${isEdit ? "Edit project" : "Add project"}</h3>
        <div class="modal-sub">Give it a header, a description, and optionally links, downloadable files, or photos.</div>

        <div class="field"><label>Header *</label><input id="pr_header" value="${esc(p.header)}" placeholder="Project name"></div>
        <div class="field"><label>Description</label><textarea id="pr_desc" placeholder="What it does, why you built it">${esc(p.description)}</textarea></div>
        <div class="field"><label>Tags (comma-separated)</label><input id="pr_tags" value="${esc((p.tags||[]).join(', '))}" placeholder="e.g. React, Node, Figma"></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Links (GitHub, live demo, etc.)</h3></div>
        ${linkRows}
        <div class="subrow">
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Type</label>
              <select id="ln_type"><option value="github">github</option><option value="live">live / demo</option><option value="other">other</option></select>
            </div>
            <div class="field" style="margin-bottom:0;"><label>Label</label><input id="ln_label" placeholder="e.g. View source"></div>
          </div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="ln_url" placeholder="https://github.com/..."></div>
          <button class="btn ghost sm" type="button" data-action="link-add">+ Add link</button>
        </div>

        <div class="subhead"><h3 style="font-size:.8rem;">Downloadable files</h3></div>
        <div class="hint" style="margin-top:-2px;">Upload from your device, paste a link, or reuse one already in your library.</div>
        ${fileRows}
        <div class="subrow">
          <div class="field" style="margin-bottom:8px;"><label>Upload from device</label><input type="file" id="fl_file"></div>
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Label (optional)</label><input id="fl_label" placeholder="e.g. Resume.pdf"></div>
            <div class="field" style="margin-bottom:0;"><label>Or paste a URL instead</label><input id="fl_url" placeholder="https://..."></div>
          </div>
          <div style="display:flex; gap:10px; margin-top:8px;">
            <button class="btn ghost sm" type="button" data-action="file-add">+ Add file</button>
            <button class="btn ghost sm" type="button" data-action="file-browse-library">Browse library</button>
          </div>
        </div>

        <div class="subhead"><h3 style="font-size:.8rem;">Photos</h3></div>
        <div class="hint" style="margin-top:-2px;">Upload from your device (resized and stored with your portfolio), paste an image URL, or reuse one already in your library.</div>
        ${imageRows}
        <div class="subrow">
          <div class="field" style="margin-bottom:8px;"><label>Upload from device</label><input type="file" id="im_file" accept="image/*"></div>
          <div class="field" style="margin-bottom:8px;"><label>Or paste an image URL</label><input id="im_url" placeholder="https://..."></div>
          <div class="field" style="margin-bottom:8px;"><label>Caption (optional)</label><input id="im_caption" placeholder="e.g. Home screen"></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" type="button" data-action="image-add">+ Add photo</button>
            <button class="btn ghost sm" type="button" data-action="image-browse-library">Browse library</button>
          </div>
        </div>

        ${profileScopeFieldHtml(p, "pr_profile_scope")}

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="project-delete">Delete project</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="project-save">${isEdit ? "Save changes" : "Add project"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="link-remove"]').forEach(b=>b.onclick=()=>{ p.links.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });
    modalRoot.querySelectorAll('[data-action="file-remove"]').forEach(b=>b.onclick=()=>{ p.files.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });
    modalRoot.querySelectorAll('[data-action="image-remove"]').forEach(b=>b.onclick=()=>{ p.images.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });

    modalRoot.querySelector('[data-action="link-add"]').onclick = ()=>{
      syncProjectFields();
      const type = document.getElementById("ln_type").value;
      const label = document.getElementById("ln_label").value.trim();
      const url = document.getElementById("ln_url").value.trim();
      if(!url){ showToast("Add a URL for the link.", true); return; }
      p.links.push({id:uid(), type, label: label || (type==="github"?"GitHub":"Link"), url});
      renderProjectModal(isEdit);
    };
    modalRoot.querySelector('[data-action="file-add"]').onclick = async ()=>{
      syncProjectFields();
      const addBtn = modalRoot.querySelector('[data-action="file-add"]');
      const fileInput = document.getElementById("fl_file");
      const file = fileInput && fileInput.files && fileInput.files[0];
      const label = document.getElementById("fl_label").value.trim();
      const url = document.getElementById("fl_url").value.trim();
      if(!file && !url){ showToast("Upload a file or paste a URL.", true); return; }
      if(file){
        addBtn.disabled = true; addBtn.textContent = "Uploading…";
        try{
          const uploadedUrl = await uploadRawFile(file);
          p.files.push({id:uid(), label: label || file.name, url: uploadedUrl});
          renderProjectModal(isEdit);
        }catch(err){
          showToast(err.message || "Couldn't upload that file — try a different one.", true);
          addBtn.disabled = false; addBtn.textContent = "+ Add file";
        }
      } else {
        if(!label){ showToast("Add a label for the link.", true); return; }
        p.files.push({id:uid(), label, url});
        renderProjectModal(isEdit);
      }
    };
    modalRoot.querySelector('[data-action="file-browse-library"]').onclick = ()=>{
      syncProjectFields();
      openMediaLibraryModal((url, name)=>{
        p.files.push({id:uid(), label:name, url});
        renderProjectModal(isEdit);
      }, false);
    };
    modalRoot.querySelector('[data-action="image-add"]').onclick = async ()=>{
      syncProjectFields();
      const fileInput = document.getElementById("im_file");
      const url = document.getElementById("im_url").value.trim();
      const caption = document.getElementById("im_caption").value.trim();
      const file = fileInput && fileInput.files && fileInput.files[0];
      if(!file && !url){ showToast("Upload a photo or paste an image URL.", true); return; }
      if(file){
        try{
          const url = await uploadImageFile(file, 1600, 0.85);
          p.images.push({id:uid(), url, caption});
          renderProjectModal(isEdit);
        }catch(err){ showToast(err.message || "Couldn't upload that image — try a different file.", true); }
      } else {
        p.images.push({id:uid(), url, caption});
        renderProjectModal(isEdit);
      }
    };
    modalRoot.querySelector('[data-action="image-browse-library"]').onclick = ()=>{
      syncProjectFields();
      openMediaLibraryModal((url, name)=>{
        p.images.push({id:uid(), url, caption:""});
        renderProjectModal(isEdit);
      }, true);
    };
    if(isEdit){
      modalRoot.querySelector('[data-action="project-delete"]').onclick = ()=>{
        const cat = data.projectCategories.find(c=>c.id===tempProjectCategoryId);
        if(cat){ const idx = cat.projects.findIndex(x=>x.id===p.id); if(idx>-1) cat.projects.splice(idx,1); }
        persistAndRender(); closeModal();
      };
    }
    modalRoot.querySelector('[data-action="project-save"]').onclick = ()=>{
      syncProjectFields();
      if(!p.header){ showToast("Give the project a header.", true); return; }
      const cat = data.projectCategories.find(c=>c.id===tempProjectCategoryId);
      if(!cat){ showToast("That category no longer exists.", true); return; }
      const idx = cat.projects.findIndex(x=>x.id===p.id);
      if(idx>-1){ cat.projects[idx]=p; } else { cat.projects.push(p); }
      persistAndRender(); closeModal();
    };
  }
  function syncProjectFields(){
    const p = tempProject;
    const headerEl = document.getElementById("pr_header");
    const descEl = document.getElementById("pr_desc");
    const tagsEl = document.getElementById("pr_tags");
    if(headerEl) p.header = headerEl.value.trim();
    if(descEl) p.description = descEl.value.trim();
    if(tagsEl) p.tags = tagsEl.value.split(",").map(s=>s.trim()).filter(Boolean);
    applyProfileScopeField(p, "pr_profile_scope");
  }

  /* ============ Global click delegation ============ */
  document.addEventListener("click", (e)=>{
    const toggleBtn = e.target.closest('[data-action="toggle-cert"]');
    if(toggleBtn){ toggleCertBox(toggleBtn.dataset.id); return; }

    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const sectionId = btn.dataset.sectionId;

    switch(action){
      case "open-lightbox": {
        const container = btn.closest(".project-images, .cert-box-inner") || btn.parentElement;
        const gallery = Array.from(container.querySelectorAll('[data-action="open-lightbox"]'));
        const images = gallery.map(el => ({ url: el.dataset.url, caption: el.dataset.caption || "" }));
        openLightbox(images, gallery.indexOf(btn));
        break;
      }
      case "nav":
        state.section = btn.dataset.section; render();
        window.scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth"});
        break;
      case "move-item": {
        if(btn.disabled) break;
        const listKey = btn.dataset.list;
        const parentId = btn.dataset.parentId;
        const dir = btn.dataset.dir === "up" ? -1 : 1;
        let arr = null;
        if(listKey === "achievements") arr = data.achievements;
        else if(listKey === "education") arr = data.education;
        else if(listKey === "skills") arr = data.skills;
        else if(listKey === "projectCategories") arr = data.projectCategories;
        else if(listKey === "experience") arr = data.experience;
        else if(listKey === "projects"){ const cat = data.projectCategories.find(c=>c.id===parentId); arr = cat ? cat.projects : null; }
        else if(listKey === "expItems"){ const sec = data.experience.find(s=>s.id===parentId); arr = sec ? sec.items : null; }
        else if(listKey === "sectionItems"){ const cs = data.customSections.find(c=>c.id===parentId); arr = cs ? cs.items : null; }
        if(arr) moveInArray(arr, id, dir);
        persistAndRender();
      } break;
      case "set-theme": prefs.theme = btn.dataset.value; applyPrefs(); savePrefs(); render(); break;
      case "set-size": prefs.size = btn.dataset.value; applyPrefs(); savePrefs(); render(); break;
      case "set-project-photo-size": data.projectPhotoSize = btn.dataset.value; persistAndRender(); break;
      case "toggle-edit":
        if(state.editing){ state.editing = false; render(); } else { openAuthModal(); }
        break;
      case "change-password": openChangePasswordModal(); break;
      case "manage-sections": openManageSectionsModal(); break;
      case "manage-profiles": openManageProfilesModal(); break;
      case "logout": logout(); break;

      case "edit-profile": openProfileModal(); break;
      case "edit-socials": openSocialsModal(); break;
      case "remove-photo": data.profile.photo = ""; persistAndRender(); break;
      case "browse-profile-photo":
        openMediaLibraryModal((url)=>{ data.profile.photo = url; persistAndRender(); }, true);
        break;

      case "add-achievement": openRecordModal("achievement", null); break;
      case "edit-achievement": openRecordModal("achievement", id); break;
      case "delete-achievement": deleteRecord("achievement", id); break;
      case "browse-existing-achievement": browseExistingRecords("achievement"); break;

      case "add-education": openRecordModal("education", null); break;
      case "edit-education": openRecordModal("education", id); break;
      case "delete-education": deleteRecord("education", id); break;
      case "browse-existing-education": browseExistingRecords("education"); break;

      case "add-project-category": openProjectCategoryModal(null); break;
      case "edit-project-category": openProjectCategoryModal(id); break;
      case "delete-project-category": { const idx=data.projectCategories.findIndex(x=>x.id===id); if(idx>-1) data.projectCategories.splice(idx,1); persistAndRender(); } break;
      case "add-project": openProjectModal(id, null); break;
      case "edit-project": openProjectModal(sectionId, id); break;
      case "delete-project": { const cat=data.projectCategories.find(c=>c.id===sectionId); if(cat){ const idx=cat.projects.findIndex(x=>x.id===id); if(idx>-1) cat.projects.splice(idx,1);} persistAndRender(); } break;
      case "browse-existing-project": browseExistingProjects(id); break;

      case "add-skill": openSkillModal(null); break;
      case "edit-skill": openSkillModal(id); break;
      case "delete-skill": { const idx=data.skills.findIndex(x=>x.id===id); if(idx>-1) data.skills.splice(idx,1); persistAndRender(); } break;
      case "browse-existing-skill": browseExistingSkills(); break;

      case "add-exp-section": openExpSectionModal(null); break;
      case "edit-exp-section": openExpSectionModal(id); break;
      case "delete-exp-section": { const idx=data.experience.findIndex(x=>x.id===id); if(idx>-1) data.experience.splice(idx,1); persistAndRender(); } break;
      case "add-exp-item": openExpItemModal(id, null); break;
      case "edit-exp-item": openExpItemModal(sectionId, id); break;
      case "delete-exp-item": { const sec=data.experience.find(s=>s.id===sectionId); if(sec){ const idx=sec.items.findIndex(i=>i.id===id); if(idx>-1) sec.items.splice(idx,1);} persistAndRender(); } break;
      case "browse-existing-exp-item": browseExistingExpItems(id); break;

      case "add-section": openAddSectionModal(); break;
      case "rename-section": openRenameSectionModal(id); break;
      case "delete-section": deleteCustomSection(id); break;
      case "edit-section-intro": openSectionIntroModal(id); break;
      case "edit-section-bullets": openSectionBulletsModal(id); break;
      case "remove-section-bullets": { const cs=data.customSections.find(c=>c.id===id); if(cs){ cs.bullets=[]; } persistAndRender(); } break;
      case "add-section-item": openSectionItemModal(id, null); break;
      case "edit-section-item": openSectionItemModal(sectionId, id); break;
      case "delete-section-item": { const cs=data.customSections.find(c=>c.id===sectionId); if(cs){ const idx=cs.items.findIndex(i=>i.id===id); if(idx>-1) cs.items.splice(idx,1);} persistAndRender(); } break;
      case "browse-existing-section-item": browseExistingSectionItems(id); break;

      case "edit-contact": openContactModal(); break;
      case "edit-contact-links": openContactLinksModal(); break;
      case "copy-email": (async()=>{
        const ok = await copyText(btn.dataset.value);
        showToast(ok ? "Email address copied" : "Couldn't copy — please copy it manually.", !ok);
      })(); break;
      case "download-vcard": downloadVCard(); break;

      case "send-message": {
        const name = document.getElementById("msg_name").value.trim();
        const email = document.getElementById("msg_email").value.trim();
        const subject = document.getElementById("msg_subject").value.trim();
        const body = document.getElementById("msg_body").value.trim();
        if(!name || !email || !body){ showToast("Fill in your name, email, and a message.", true); return; }
        const to = (data.contact && data.contact.email) || "";
        if(!to){ showToast("No contact email is set up yet.", true); return; }
        const mailSubject = subject || `Portfolio message from ${name}`;
        const mailBody = `From: ${name} (${email})\n\n${body}`;
        openMailClient(to, mailSubject, mailBody);
        showToast(`Opening your email app to send this to ${to}`);
      } break;
    }
  });

  document.addEventListener("change", async (e)=>{
    if(e.target && e.target.id === "profile_photo_file"){
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      try{
        const url = await uploadImageFile(file, 600, 0.85);
        data.profile.photo = url;
        persistAndRender();
      }catch(err){ showToast(err.message || "Couldn't upload that image.", true); }
    }
  });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape" && modalRoot.innerHTML.trim() !== ""){ closeModal(); }
  });

  /* ============ Boot ============ */
  (async function boot(){
    try{
      await loadAll();
      render();
    }catch(e){
      console.error("Boot failed:", e);
      page.innerHTML = `<div class="empty-state" style="padding:60px 20px; text-align:center;">
        Something went wrong loading this page. Try refreshing — if it keeps happening, check the browser console for details.
      </div>`;
    }
  })();
})();
