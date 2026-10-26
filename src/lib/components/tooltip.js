// One floating tooltip per chart. Content is built with textContent (school names are data).
export function createTooltip() {
	const el = document.createElement('div');
	el.className = 'tooltip';
	el.hidden = true;
	el.setAttribute('role', 'status');
	document.body.appendChild(el);

	function show({ title, rows = [], note }, clientX, clientY) {
		el.replaceChildren();
		if (title) {
			const t = document.createElement('div');
			t.className = 'tt-title';
			t.textContent = title;
			el.appendChild(t);
		}
		for (const [label, value] of rows) {
			const r = document.createElement('div');
			r.className = 'tt-row';
			const l = document.createElement('span');
			l.textContent = label;
			const v = document.createElement('strong');
			v.textContent = value;
			r.append(l, v);
			el.appendChild(r);
		}
		if (note) {
			const n = document.createElement('div');
			n.className = 'tt-note';
			n.textContent = note;
			el.appendChild(n);
		}
		el.hidden = false;
		const pad = 14;
		const { width, height } = el.getBoundingClientRect();
		let x = clientX + pad;
		let y = clientY + pad;
		if (x + width > window.innerWidth - 8) x = Math.max(8, clientX - width - pad);
		if (y + height > window.innerHeight - 8) y = Math.max(8, clientY - height - pad);
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
	}

	return {
		show,
		hide: () => (el.hidden = true),
		destroy: () => el.remove()
	};
}
