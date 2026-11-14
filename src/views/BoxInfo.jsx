import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const FIELDS = 'name, tagline, address, postal_code, city, phone, email, website, instagram, siret, opening_hours, welcome_message, rules_url'

// Réduit l'image (512 px max) avant l'envoi : logo net, fichier léger
function resize(file, max = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      c.toBlob((b) => (b ? resolve({ blob: b, type }) : reject(new Error('Image illisible'))), type, 0.9)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = URL.createObjectURL(file)
  })
}

export default function BoxInfo({ box, toast, log, onBoxChange }) {
  const init = Object.fromEntries(FIELDS.split(', ').map((k) => [k, box[k] || '']))
  const [f, setF] = useState(init)
  const [logo, setLogo] = useState(box.logo_url || '')
  const [busy, setBusy] = useState(false)
  const [up, setUp] = useState(false)
  const input = useRef(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const dirty = JSON.stringify(f) !== JSON.stringify(init)

  async function save(e) {
    e.preventDefault()
    if (!f.name.trim()) return toast('Le nom de la salle est obligatoire')
    setBusy(true)
    const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    clean.name = f.name.trim()
    if (clean.instagram) clean.instagram = clean.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
    if (clean.website && !/^https?:\/\//.test(clean.website)) clean.website = 'https://' + clean.website
    if (clean.rules_url && !/^https?:\/\//.test(clean.rules_url)) clean.rules_url = 'https://' + clean.rules_url
    const { error } = await supabase.from('boxes').update(clean).eq('id', box.id)
    setBusy(false)
    if (error) return toast(error.message)
    if (clean.name !== box.name) await log('Salle renommée : ' + clean.name)
    toast('Infos de la salle enregistrées')
    onBoxChange()
  }

  async function upload(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast('Choisis une image PNG ou JPEG')
    if (file.size > 10 * 1024 * 1024) return toast('Image trop lourde (10 Mo maximum)')
    setUp(true)
    try {
      const { blob, type } = await resize(file)
      const path = box.id + '/logo-' + Date.now() + (type === 'image/png' ? '.png' : '.jpg')
      const { error } = await supabase.storage.from('box-logos').upload(path, blob, { contentType: type, upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('box-logos').getPublicUrl(path)
      const { error: e2 } = await supabase.from('boxes').update({ logo_url: data.publicUrl }).eq('id', box.id)
      if (e2) throw e2
      // on supprime l'ancien logo
      if (box.logo_url && box.logo_url.includes('/box-logos/')) {
        const old = box.logo_url.split('/box-logos/')[1]
        if (old && old.startsWith(box.id + '/')) await supabase.storage.from('box-logos').remove([old])
      }
      setLogo(data.publicUrl)
      toast('Logo mis à jour')
      onBoxChange()
    } catch (err) {
      toast(err.message || String(err))
    }
    setUp(false)
  }
  async function removeLogo() {
    if (!window.confirm('Retirer le logo ?')) return
    const { error } = await supabase.from('boxes').update({ logo_url: null }).eq('id', box.id)
    if (error) return toast(error.message)
    const old = (box.logo_url || '').split('/box-logos/')[1]
    if (old && old.startsWith(box.id + '/')) await supabase.storage.from('box-logos').remove([old])
    setLogo('')
    onBoxChange()
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="card">
        <div className="spread"><div><h2>Infos de la salle</h2><p className="sub">Ce que tes adhérents et ton équipe voient dans l'app. Tu peux les changer quand tu veux.</p></div>
          <button className="btn" disabled={busy || !dirty}>{busy ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</button></div>

        <div className="identity">
          <div className="logobox">
            {logo ? <img src={logo} alt={'Logo ' + f.name} /> : <span className="logoph">{(f.name || '?').slice(0, 2).toUpperCase()}</span>}
          </div>
          <div className="stack" style={{ flex: 1, gap: 8 }}>
            <p className="phase" style={{ marginTop: 0 }}>Logo</p>
            <span className="sub">PNG ou JPEG, carré de préférence. Il apparaît en haut de l'app et sur l'écran de tes adhérents.</span>
            <div className="row">
              <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={upload} />
              <button type="button" className="btn small" disabled={up} onClick={() => input.current.click()}>{up ? 'Envoi…' : logo ? 'Changer le logo' : 'Importer un logo'}</button>
              {logo && <button type="button" className="btn small ghost" onClick={removeLogo}>Retirer</button>}
            </div>
          </div>
        </div>

        <div className="form">
          <label className="full">Nom de la salle<input value={f.name} onChange={set('name')} required maxLength={60} /></label>
          <label className="full">Présentation courte<input value={f.tagline} onChange={set('tagline')} maxLength={120} placeholder="Ex. : CrossFit, haltéro et Hyrox au cœur de Perpignan" /></label>
        </div>
      </div>

      <div className="card">
        <h3>Coordonnées</h3>
        <div className="form">
          <label className="full">Adresse<input value={f.address} onChange={set('address')} autoComplete="street-address" placeholder="12 rue des Sports" /></label>
          <label>Code postal<input value={f.postal_code} onChange={set('postal_code')} inputMode="numeric" maxLength={10} /></label>
          <label>Ville<input value={f.city} onChange={set('city')} /></label>
          <label>Téléphone<input value={f.phone} onChange={set('phone')} type="tel" placeholder="06 00 00 00 00" /></label>
          <label>E-mail de contact<input value={f.email} onChange={set('email')} type="email" placeholder="contact@mabox.fr" /></label>
          <label>Site web<input value={f.website} onChange={set('website')} placeholder="mabox.fr" /></label>
          <label>Instagram<input value={f.instagram} onChange={set('instagram')} placeholder="@mabox" /></label>
          <label className="full">Horaires d'accueil<textarea value={f.opening_hours} onChange={set('opening_hours')} rows={3} placeholder={'Lun–ven : 6h30–21h\nSam : 9h–13h'} /></label>
        </div>
      </div>

      <div className="card">
        <h3>Pour tes adhérents</h3>
        <div className="form">
          <label className="full">Message de bienvenue<textarea value={f.welcome_message} onChange={set('welcome_message')} rows={3} maxLength={500} placeholder="Ex. : Bienvenue dans la team ! Arrive 10 minutes avant ton premier cours, on te fait visiter." /></label>
          <label className="full">Lien vers le règlement intérieur ou les CGV<input value={f.rules_url} onChange={set('rules_url')} placeholder="mabox.fr/cgv" /></label>
        </div>
        <p className="sub">Les conditions générales sont indispensables dès que tu encaisses en ligne (prélèvement mensuel, engagement, résiliation).</p>
      </div>

      <div className="card">
        <h3>Administratif</h3>
        <div className="form">
          <label>SIRET<input value={f.siret} onChange={set('siret')} inputMode="numeric" maxLength={17} placeholder="123 456 789 00012" /></label>
        </div>
        <p className="sub">Utile pour ton inscription Stripe et tes reçus. Non visible par les adhérents.</p>
      </div>

      {dirty && <div className="savebar"><span>Modifications non enregistrées</span><button className="btn" disabled={busy}>Enregistrer</button></div>}
    </form>
  )
}
