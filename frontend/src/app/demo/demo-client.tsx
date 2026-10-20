"use client";

import { useMemo, useState } from "react";
import styles from "./demo.module.css";
import compact from "./compact.module.css";

type Priority = "Urgent" | "FYI" | "Low Priority";
type View = "briefing" | "inbox" | "calendar" | "compose";
type Mail = { id: number; sender: string; email: string; subject: string; time: string; preview: string; body: string; summary: string; priority: Priority; unread: boolean; date?: string; attachment?: string };

const initialMail: Mail[] = [
  { id: 1, sender: "Professor Kim", email: "prof.kim@stonybrook.edu", subject: "Project milestone review", time: "9:42 AM", preview: "Please share your team prototype before Thursday's meeting.", body: "Hi team,\n\nPlease share your team prototype before our Thursday, October 22 meeting at 2:00 PM in CS 120. I would like to review the main flows and give you feedback on the data design.\n\nBest,\nProfessor Kim", summary: "Prototype due before Thursday's 2 PM review. Bring the main flows and data design.", priority: "Urgent", unread: true, date: "2026-10-22", attachment: "Project-review-notes.pdf" },
  { id: 2, sender: "Career Center", email: "careercenter@stonybrook.edu", subject: "Fall internship application deadline", time: "8:18 AM", preview: "Applications close Friday at 5:00 PM.", body: "Hello,\n\nThe fall internship application closes Friday, October 23 at 5:00 PM Eastern. Please submit your resume and statement before the deadline.\n\nCareer Center", summary: "Internship applications close Friday at 5 PM Eastern.", priority: "Urgent", unread: true, date: "2026-10-23" },
  { id: 3, sender: "Seunghoon Jang", email: "seunghoon.jang@stonybrook.edu", subject: "Updated wireframes for MailFlow", time: "7:55 AM", preview: "I made a few changes to the calendar preview screen.", body: "Hi,\n\nI updated the MailFlow wireframes. The calendar preview now shows the source sentence next to the editable date fields. Please take a look when you have time.\n\nThanks,\nSeunghoon", summary: "Updated wireframes include an improved calendar preview.", priority: "FYI", unread: false, attachment: "mailflow-wireframes.pdf" },
  { id: 4, sender: "Library Services", email: "library@stonybrook.edu", subject: "Library hours this week", time: "7:30 AM", preview: "The main library will have extended evening hours.", body: "Hello,\n\nThe main library will stay open until midnight this week. Study rooms can be reserved online.\n\nLibrary Services", summary: "The library is open until midnight this week.", priority: "FYI", unread: false },
  { id: 5, sender: "Campus Dining", email: "dining@stonybrook.edu", subject: "This week's dining specials", time: "6:45 AM", preview: "See the seasonal menu at campus dining locations.", body: "Hi,\n\nCheck out this week's seasonal menu at campus dining locations.\n\nCampus Dining", summary: "Weekly dining menu announcement.", priority: "Low Priority", unread: false },
];
const order: Priority[] = ["Urgent", "FYI", "Low Priority"];
const nav: { key: View; label: string }[] = [
  { key: "briefing", label: "Daily Briefing" }, { key: "inbox", label: "All Emails" },
  { key: "calendar", label: "Calendar" }, { key: "compose", label: "Compose" },
];
const events = [
  { day: 22, time: "2:00 PM", title: "Project milestone review", place: "CS 120" },
  { day: 23, time: "5:00 PM", title: "Internship application deadline", place: "Online" },
];

function NavIcon({ view }: { view: View }) {
  const iconClass = `${compact.navIcon} ${view === "briefing" ? compact.briefingIcon : view === "inbox" ? compact.mailIcon : view === "calendar" ? compact.calendarIcon : compact.composeIcon}`;
  if (view === "briefing") return <svg className={iconClass} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6.5 14.5a5.5 5.5 0 0 1 11 0M12 3v3M4.9 7.4 7 9M19.1 7.4 17 9" /></svg>;
  if (view === "inbox") return <svg className={iconClass} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>;
  if (view === "calendar") return <svg className={iconClass} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></svg>;
  return <svg className={iconClass} viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l3.8-.8L19 8a2.1 2.1 0 0 0-3-3L4.8 16.2 4 20Z" /><path d="m6 15 3 3" /></svg>;
}

function CompactBriefing({ mail, counts, openMail, openCalendar }: {
  mail: Mail[];
  counts: Record<Priority, number>;
  openMail: (id: number) => void;
  openCalendar: () => void;
}) {
  return (
    <div className={styles.content}>
      <div className={styles.metricGrid}>
        <div className={styles.metric}><span>NEW EMAILS</span><b>{mail.length}</b><small>Across your inbox</small></div>
        {order.map((priority) => (
          <div className={styles.metric} key={priority}>
            <span>{priority.toUpperCase()}</span><b>{counts[priority]}</b>
            <small>{priority === "Urgent" ? "Needs attention" : priority === "FYI" ? "Stay informed" : "Read later"}</small>
          </div>
        ))}
      </div>

      <div className={`${styles.briefingTop} ${compact.scheduleOnly}`}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>YOUR DAY</span><h2>Today&apos;s schedule</h2></div><button className={styles.textButton} onClick={openCalendar}>View full calendar →</button></div>
          {events.map((event) => <div className={styles.scheduleRow} key={event.title}><strong>{event.time}</strong><span><b>{event.title}</b><small>{event.place}</small></span></div>)}
        </section>
      </div>

      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>PRIORITIZED INBOX</span><h2>Today&apos;s emails</h2></div></div>
      <div className={`${styles.columnGrid} ${compact.priorityGrid}`}>
        {order.map((priority) => {
          const group = mail.filter((item) => item.priority === priority);
          return <section className={`${styles.priorityColumn} ${compact.prioritySection} ${priority === "Urgent" ? compact.urgentLane : priority === "FYI" ? compact.fyiLane : compact.lowpriorityLane}`} key={priority}>
            <div className={`${styles.columnHead} ${compact.priorityTab}`}>
              <span className={`${compact.priorityPill} ${compact[priority.replace(" ", "").toLowerCase()]}`}>{group.length} {priority}</span>
            </div>
            {group.map((item) => <button className={styles.mailCard} key={item.id} onClick={() => openMail(item.id)}><span className={styles.cardMeta}>{item.sender}<time>{item.time}</time></span><b>{item.subject}</b><p>{item.summary}</p><span className={styles.cardLink}>Read message →</span></button>)}
          </section>;
        })}
      </div>
    </div>
  );
}

export function DemoClient() {
  const [view, setView] = useState<View>("briefing");
  const [mail, setMail] = useState(initialMail);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Priority | "All" | "Unread">("All");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"send" | "event" | null>(null);
  const [toast, setToast] = useState("");
  const [tone, setTone] = useState(50);
  const [length, setLength] = useState(45);
  const [draft, setDraft] = useState("Hi Professor Kim,\n\nThanks for the reminder. We'll share our prototype before Thursday's review and bring the data design.\n\nBest,\nDonghyun");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventZone, setEventZone] = useState("America/New_York");
  const [eventPlace, setEventPlace] = useState("");
  const current = mail.find((item) => item.id === selected);
  const counts = useMemo(() => Object.fromEntries(order.map((p) => [p, mail.filter((m) => m.priority === p).length])) as Record<Priority, number>, [mail]);
  const visible = mail.filter((item) => (filter === "All" || (filter === "Unread" ? item.unread : item.priority === filter)) && `${item.sender} ${item.subject} ${item.body}`.toLowerCase().includes(query.toLowerCase()));
  const openMail = (id: number) => {
    const item = mail.find((message) => message.id === id);
    if (!item) return;
    setSelected(id);
    setDraft(`Hi ${item.sender},\n\nThanks for your message about ${item.subject.toLowerCase()}. I'll review the details and get back to you shortly.\n\nBest,\nDonghyun`);
    setMail((items) => items.map((message) => message.id === id ? { ...message, unread: false } : message));
  };
  const openEvent = (item: Mail) => { setEventTitle(item.subject); setEventDate(item.date || ""); setEventTime(item.id === 1 ? "14:00" : ""); setEventPlace(item.id === 1 ? "CS 120" : ""); setDialog("event"); };
  const switchView = (next: View) => { setView(next); setSelected(null); setToast(""); };
  const confirmSend = () => { setDialog(null); setToast("Demo: message reviewed. No email was sent."); };
  const confirmEvent = () => { setDialog(null); setToast("Demo: event reviewed. No calendar event was created."); };
  const composing = view === "compose";
  const recipient = composing ? to : current?.email || "";
  const outgoingSubject = composing ? subject : `Re: ${current?.subject || ""}`;
  const outgoingBody = composing ? body : draft;
  const validRecipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  const composeSummary = body.trim()
    ? `${subject.trim() ? `${subject.trim()}: ` : ""}${body.trim().split(/\s+/).slice(0, 24).join(" ")}${body.trim().split(/\s+/).length > 24 ? "…" : ""}`
    : "Start writing your message to see a concise overview here.";

  return <div className={`${styles.shell} ${compact.shell}`}>
    <nav aria-label="Demo pages" className={compact.actionRail}>
      {nav.map((item) => <button key={item.key} aria-current={view === item.key ? "page" : undefined} className={`${compact.actionButton} ${view === item.key ? compact.activeActionButton : ""}`} onClick={() => switchView(item.key)}><NavIcon view={item.key} /><span>{item.label}</span>{item.key === "briefing" && <em>{counts.Urgent}</em>}</button>)}
    </nav>
    <main className={`${styles.main} ${compact.fullWidthMain}`}>
      <header className={styles.topbar}><div><h1>{current ? "Email details" : view === "briefing" ? "Good morning, Donghyun" : view === "inbox" ? "All Emails" : view === "calendar" ? "Calendar" : "New Email"}</h1><p>{current ? "Read the original message, then review AI suggestions." : view === "briefing" ? "Tuesday, October 20, 2026 · Here is what needs your attention." : view === "inbox" ? "One connected account · Last synced just now" : view === "calendar" ? "Your schedule and approved email events" : "Write a message and review it before sending."}</p></div></header>
      {toast && <div role="status" className={styles.toast}>{toast}<button onClick={() => setToast("")} aria-label="Dismiss notification">×</button></div>}
      {current ? <div className={styles.content}><button className={styles.back} onClick={() => setSelected(null)}>← Back to {view === "briefing" ? "briefing" : "emails"}</button><div className={styles.detailGrid}><section className={styles.panel}><div className={styles.detailHeader}><span className={styles.eyebrow}>ORIGINAL EMAIL</span><select aria-label="Priority" value={current.priority} onChange={(e) => setMail((items) => items.map((item) => item.id === current.id ? { ...item, priority: e.target.value as Priority } : item))}>{order.map((p) => <option key={p}>{p}</option>)}</select></div><h2>{current.subject}</h2><div className={styles.senderLine}><span className={styles.avatar}>{current.sender.split(" ").map((s) => s[0]).join("")}</span><span><b>{current.sender}</b><small>{current.email}</small></span><time>{current.time}</time></div><p className={styles.emailBody}>{current.body}</p>{current.attachment && <div className={styles.attachment}>↳ {current.attachment}</div>}{current.date && <button className={styles.dateLink} onClick={() => openEvent(current)}>▦ Date detected: {current.date} · Preview event →</button>}</section><div className={styles.sidePanels}><section className={styles.panel}><span className={styles.eyebrow}>✦ AI SUMMARY</span><h3>At a glance</h3><p>{current.summary}</p><small className={styles.hint}>AI suggestions may be inaccurate. Check the original message.</small></section><section className={styles.panel}><span className={styles.eyebrow}>✦ SUGGESTED REPLY</span><h3>Draft a response</h3><label className={styles.fieldLabel} htmlFor="reply">Editable message</label><textarea id="reply" value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} /><div className={styles.slider}><label htmlFor="tone">Tone <strong>{tone < 35 ? "Friendly" : tone > 65 ? "Professional" : "Balanced"}</strong></label><input id="tone" type="range" min="0" max="100" value={tone} onChange={(e) => setTone(Number(e.target.value))} /><div><span>Friendly</span><span>Professional</span></div></div><div className={styles.slider}><label htmlFor="length">Length <strong>{length < 35 ? "Short" : length > 65 ? "Detailed" : "Standard"}</strong></label><input id="length" type="range" min="0" max="100" value={length} onChange={(e) => setLength(Number(e.target.value))} /><div><span>Short</span><span>Detailed</span></div></div><p className={styles.hint}>Slider values are illustrative in this design preview. Edit the draft directly.</p><button className={styles.primary} onClick={() => setDialog("send")} disabled={!draft.trim()}>Review &amp; Send →</button></section></div></div></div> : view === "briefing" ? <CompactBriefing mail={mail} counts={counts} openMail={openMail} openCalendar={() => switchView("calendar")} /> : view === "inbox" ? <div className={styles.content}><section className={styles.panel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>INBOX</span><h2>Messages</h2></div><button className={styles.primary} onClick={() => switchView("compose")}>+ Compose</button></div><label className={styles.search}><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sender, subject, or message" aria-label="Search emails" /></label><div className={styles.filters}>{(["All", "Unread", ...order] as const).map((p) => <button className={filter === p ? styles.selectedFilter : ""} key={p} onClick={() => setFilter(p)}>{p} <span>{p === "All" ? mail.length : p === "Unread" ? mail.filter((m) => m.unread).length : counts[p]}</span></button>)}</div><div className={styles.mailList}>{visible.length ? visible.map((item) => <button className={styles.mailRow} key={item.id} onClick={() => openMail(item.id)}><span className={styles.avatar}>{item.sender.split(" ").map((s) => s[0]).join("")}</span><span className={styles.rowText}><span><b>{item.sender}</b>{item.unread && <i aria-label="Unread" />}</span><strong>{item.subject}</strong><small>{item.preview}</small></span><span className={styles.rowEnd}><time>{item.time}</time><em className={`${compact.mailPriorityLabel} ${compact[item.priority.replace(" ", "").toLowerCase()]}`}>{item.priority}</em></span></button>) : <p className={styles.empty}>No messages match this search or filter.</p>}</div></section></div> : view === "calendar" ? <div className={styles.content}><section className={styles.panel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>OCTOBER 2026</span><h2>Your calendar</h2></div><div className={styles.viewToggle}><button className={styles.selectedFilter}>Month</button><button onClick={() => setToast("Week view is a planned screen in this preview.")}>Week</button></div></div><div className={styles.calendarGrid}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <b key={day}>{day}</b>)}{Array.from({ length: 35 }, (_, i) => { const day = i - 3; const event = events.find((item) => item.day === day); return <div key={i} className={day === 20 ? styles.today : ""}><span>{day > 0 && day <= 31 ? day : ""}</span>{event && <small>{event.title}</small>}</div>; })}</div></section></div> : <div className={styles.content}><div className={styles.detailGrid}><section className={`${styles.panel} ${styles.compose} ${compact.composeWide}`}><span className={styles.eyebrow}>MANUAL COMPOSE</span><h2>New message</h2><p className={styles.hint}>Write your message, then use the AI controls to review its tone and length.</p><label className={styles.fieldLabel} htmlFor="to">To</label><input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />{to && !validRecipient && <small className={styles.validation}>Enter a valid email address.</small>}<label className={styles.fieldLabel} htmlFor="subject">Subject</label><input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Add a subject" /><label className={styles.fieldLabel} htmlFor="body">Message</label><textarea id="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message here..." /><div className={styles.composeActions}><button className={styles.secondary} onClick={() => { setTo(""); setSubject(""); setBody(""); }}>Discard</button><button className={styles.secondary} onClick={() => setToast("Demo: draft saved locally for this preview.")}>Save draft</button><button className={styles.primary} disabled={!validRecipient || !subject.trim() || !body.trim()} onClick={() => setDialog("send")}>Review &amp; Send →</button></div></section><div className={styles.sidePanels}><section className={styles.panel}><span className={styles.eyebrow}>✦ AI SUMMARY</span><h3>Message overview</h3><p>{composeSummary}</p><small className={styles.hint}>This preview updates as you write. Review the full message before sending.</small></section><section className={styles.panel}><span className={styles.eyebrow}>✦ AI WRITING CONTROLS</span><h3>Adjust your draft</h3><div className={styles.slider}><label htmlFor="compose-tone">Tone <strong>{tone < 35 ? "Friendly" : tone > 65 ? "Professional" : "Balanced"}</strong></label><input id="compose-tone" type="range" min="0" max="100" value={tone} onChange={(e) => setTone(Number(e.target.value))} /><div><span>Friendly</span><span>Professional</span></div></div><div className={styles.slider}><label htmlFor="compose-length">Length <strong>{length < 35 ? "Short" : length > 65 ? "Detailed" : "Standard"}</strong></label><input id="compose-length" type="range" min="0" max="100" value={length} onChange={(e) => setLength(Number(e.target.value))} /><div><span>Short</span><span>Detailed</span></div></div><p className={styles.hint}>Controls are illustrative in this design preview.</p></section></div></div></div>}
    </main>
    {dialog && <div className={styles.overlay} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className={styles.close} aria-label="Close dialog" onClick={() => setDialog(null)}>×</button>{dialog === "send" ? <><span className={styles.eyebrow}>FINAL REVIEW</span><h2 id="dialog-title">Confirm your message</h2><p className={styles.hint}>Check the recipient and full message before sending.</p><dl><dt>To</dt><dd>{recipient}</dd><dt>Subject</dt><dd>{outgoingSubject}</dd></dl><pre>{outgoingBody}</pre><div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDialog(null)}>Back to edit</button><button className={styles.secondary} onClick={() => setDialog(null)}>Cancel</button><button className={styles.primary} onClick={confirmSend}>Confirm &amp; Send</button></div></> : <><span className={styles.eyebrow}>CALENDAR SUGGESTION</span><h2 id="dialog-title">Review event details</h2><p className={styles.hint}>Source: {current?.body.split("\n").find((line) => line.includes("October")) || "Date mentioned in email"}</p><div className={styles.eventFields}><label>Title<input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} /></label><label>Date<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label><label>Time<input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} /></label><label>Time zone<input value={eventZone} onChange={(e) => setEventZone(e.target.value)} /></label><label>Location<input value={eventPlace} onChange={(e) => setEventPlace(e.target.value)} /></label></div>{!eventDate || !eventTime ? <p className={styles.validation}>Confirm the missing or ambiguous date and time before adding.</p> : null}<div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDialog(null)}>Cancel</button><button className={styles.primary} disabled={!eventTitle.trim() || !eventDate || !eventTime || !eventZone.trim()} onClick={confirmEvent}>Add to Calendar</button></div></>}</div></div>}
  </div>;
}
