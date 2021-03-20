class Menu {
	constructor(settings = {}) {
		const typeEnum = ['contextmenu', 'menubar'];
		let items = [];
		let type = isValidType(settings.type) ? settings.type : 'contextmenu';
		let beforeShow = settings.beforeShow;
		Object.defineProperty(this, 'items', {
			get: () => {
				return items;
			}
		});

		Object.defineProperty(this, 'beforeShow', {
			get: () => {
				return beforeShow;
			}
		});

	 	Object.defineProperty(this, 'type', {
			get: () => {
				return type;
			},
			set: (typeIn) => {
				type = isValidType(typeIn) ? typeIn : type;
			}
		});

		this.append = item => {
			if(!(item instanceof MenuItem)) {
				console.error('appended item must be an instance of MenuItem');
				return false;
			}
			let index = items.push(item);
			return index;
		};

		this.insert = (item, index) => {
			if(!(item instanceof MenuItem)) {
				console.error('inserted item must be an instance of MenuItem');
				return false;
			}

			items.splice(index, 0, item);
			return true;
		};

		this.remove = item => {
			if(!(item instanceof MenuItem)) {
				console.error('item to be removed is not an instance of MenuItem');
				return false;
			}

			let index = items.indexOf(item);
			if(index < 0) {
				console.error('item to be removed was not found in this.items');
				return false;
			} else {
				items.splice(index, 0);
				return true;
			}
		};

		this.removeAt = index => {
			items.splice(index, 0);
			return true;
		};

		this.node = null;

		function isValidType(typeIn = '', debug = false) {
			if(typeEnum.indexOf(typeIn) < 0) {
				if(debug) console.error(`${typeIn} is not a valid type`);
				return false;
			}
			return true;
		}

	}

	createMacBuiltin() {
		console.error('This method is not available in browser :(');
		return false;
	}

	popup(x, y, itemNode = null, menubarSubmenu = false) {
		Menu._keydownListen(true);

		let setRight = false;

		let submenu = itemNode != null || this.submenu;
		this.submenu = menubarSubmenu;

		menubarSubmenu = menubarSubmenu || this.menubarSubmenu;
		this.menubarSubmenu = menubarSubmenu;
		if (! Menu._topmostMenu) {
			Menu._topmostMenu = this;
			let el = Menu.contextMenuParent || document.body;
			Menu._listenerElement = el;
			el.addEventListener('mouseup', Menu._mouseHandler, false);
			el.addEventListener('mousedown', Menu._mouseHandler, false);
		}

		let menuNode = this.buildMenu(submenu, menubarSubmenu);
		menuNode.jsMenu = this;
		this.node = menuNode;
		Menu._currentMenuNode = menuNode;

		let top = Menu.contextMenuParent || document.body;
		if(this.node.parentNode) {
			if(menuNode === this.node) return;
			this.node.parentNode.replaceChild(menuNode, this.node);
		} else {
			(itemNode || top).appendChild(this.node);
		}

		let width = menuNode.clientWidth;
		let height = menuNode.clientHeight;
		let wwidth = top.offsetWidth;

		if ((x + width) > wwidth) {
			setRight = true;
			if(submenu && ! menubarSubmenu) {
				x = wwidth - itemNode.parentNode.offsetLeft + 2;
				if (width + x > wwidth) {
					x = 0;
					setRight = false;
				}
			} else {
				x = 0;
			}
		}

		let wheight = top.offsetHeight;
		if((y + height) > wheight) {
			y = wheight - height;
		}

		if(!setRight) {
			menuNode.style.left = x + 'px';
			menuNode.style.right = 'auto';
		} else {
			menuNode.style.right = x + 'px';
			menuNode.style.left = 'auto';
		}

		menuNode.style.top = y + 'px';
		menuNode.classList.add('show');
	}

	popdown() {
		this.items.forEach(item => {
			if(item.submenu) {
				item.submenu.popdown();
			} else {
				item.node = null;
			}
		});
		if(this.node && this.type !== 'menubar') {
			Menu._currentMenuNode = this.node.parentMenuNode;
			if (this.menubarSubmenu)
				this.node.menuItem.classList.remove('submenu-active');
			this.node.parentNode.removeChild(this.node);
			this.node = null;
		}
		if (this == Menu._topmostMenu) {
			Menu._topmostMenu = null;
			let el = Menu._listenerElement;
			if (el) {
				el.removeEventListener('mouseup', Menu._mouseHandler, false);
				el.removeEventListener('mousedown', Menu._mouseHandler, false);
				Menu._listenerElement = null;
			}
		}

		if(this.type === 'menubar') {
			this.clearActiveSubmenuStyling();
		}
	}

	static popdownAll() {
		Menu._topmostMenu.popdown();
		return;
	}

	buildMenu(submenu = false, menubarSubmenu = false) {
		if (this.beforeShow)
			(this.beforeShow)(this);
		let menuNode = document.createElement('ul');
		menuNode.classList.add('nwjs-menu', this.type);
		if(submenu) menuNode.classList.add('submenu');
		if(menubarSubmenu) menuNode.classList.add('menubar-submenu');

		menuNode.jsMenu = this;
		menuNode.parentMenuNode = Menu._currentMenuNode;
		this.items.forEach(item => {
			if (item.beforeShow)
				(item.beforeShow)(item);
			if (item.visible) {
				item.buildItem(menuNode,
					       this.type === 'menubar');
			}
		});
		return menuNode;
	}

	static isDescendant(parent, child) {
		let node = child.parentNode;
		while(node !== null) {
			if(node === parent) {
				return true;
			}
			node = node.parentNode;
		}
		return false;
	}

	static _inMenubar(node) {
		if (Menu._menubarNode === null)
			return false;
		while(node instanceof Element
		      && ! node.classList.contains('submenu')) {
			if(node === Menu._menubarNode)
				return true;
			node = node.parentNode;
		}
		return false;
	}
	static _mouseHandler(e) {
		let inMenubar = Menu._inMenubar(e.target);
		let menubarHandler = e.currentTarget == Menu._menubarNode;
		let miNode = e.target;
		while (miNode && ! miNode.jsMenuItem)
			miNode = miNode.parentNode;
		/* mouseenter:
		     if selected sibling: unhighlight (and popdown if submenu)
		     select item and if submenu popup
		   mouseout (or mouseleave):
		     if (! submenu) unhighlight
		   mousedown:
		   if (miNode) select
		   else popdownAll
		*/
		if (e.type=="mousedown" && !miNode) {
			if (Menu._topmostMenu)
				Menu.popdownAll();
		}
		if ((inMenubar == menubarHandler) && miNode) {
			let item = miNode.jsMenuItem;
			if (e.type=="mousedown") {
				item.node.classList.toggle('submenu-active');
				// FIXME use select method
				if(item.submenu) {
					if(item.node.classList.contains('submenu-active')) {
						miNode.jsMenu.node.activeItemNode = item.node;

						item.popupSubmenu(item.node.offsetLeft, item.node.offsetHeight, true);
					} else {
						item.submenu.popdown();
						miNode.jsMenu.node.currentSubmenu = null;
						miNode.jsMenu.node.activeItemNode = null;
					}
				}
			}
			if (e.type=="mouseup") {
				item.doit(miNode);
			}
		}
	}

	static setApplicationMenu(menubar, parent=null) {
		let oldNode = Menu._menubarNode;
		Menu._keydownListen(true);
		if (oldNode) {
			let parent = oldNode.parentNode;
			if (parent != null)
				parent.removeChild(oldNode);
			oldNode.removeEventListener('mousedown', Menu._mouseHandler, false);
			Menu._menubarNode = null;
		}
		if (menubar != null) {
			if (parent == null)
				parent = Menu._menubarParent || document.body;
			Menu._menubarParent = parent;
			let newNode = menubar.buildMenu();
			newNode.jsMenuItem = null;
			parent.insertBefore(newNode, parent.firstChild);
			newNode.addEventListener('mousedown', Menu._mouseHandler, false);
			Menu._menubarNode = newNode;
			menubar.node = newNode;
		}
		Menu._menubar = menubar;
	}

	clearActiveSubmenuStyling(notThisNode) {
		if (! this.node)
			return;
		let submenuActive = this.node.querySelectorAll('.submenu-active');
		for(let node of submenuActive) {
			if(node === notThisNode) continue;
			node.classList.remove('submenu-active');
		}
	}

	static recursiveNodeFind(menu, node) {
		if(menu.node === node) {
			return true;
		} else if(Menu.isDescendant(menu.node, node)) {
			return true;
		} else if(menu.items.length > 0) {
			for(var i=0; i < menu.items.length; i++) {
				let menuItem = menu.items[i];
				if(!menuItem.node) continue;

				if(menuItem.node === node) {
					return true;
				} else if(Menu.isDescendant(menuItem.node, node)) {
					return true;
				} else {
					if(menuItem.submenu) {
						if(recursiveNodeFind(menuItem.submenu, node)) {
							return true;
						} else {
							continue;
						}
					}
				}
			}
		} else {
			return false;
		}
		return false;
	}

	isNodeInChildMenuTree(node = false) {
		if(!node) return false;
		return recursiveNodeFind(this, node);
	}
}

// Parent node for context menu popup.  If null, document.body is the default.
Menu.contextMenuParent = null;

Menu._currentMenuNode = null;

Menu._keydownListener = function(e) {
	function nextItem(menuNode, curNode, forwards) {
		let nullSeen = false;
		let next = curNode;
		for (;;) {
			next = !next ? null
				: forwards ? next.nextSibling
				: next.previousSibling;
			if (! next) {
				next = forwards ? menuNode.firstChild
					: menuNode.lastChild;
				if (nullSeen || !next)
					return null;
				nullSeen = true;
			}
			if (next instanceof Element
			    && next.classList.contains("menu-item")
			    && next.jsMenuItem.type != 'separator'
			    && ! (next.classList.contains("disabled")))
				return next;
		}
	}
	function nextMenu(menuNode, forwards) {
		let menubarNode = menuNode.menuItem.parentNode;
		let next = nextItem(menubarNode,
				    menubarNode.activeItemNode,
				    forwards);
		if (next)
		    next.jsMenuItem.select(next, true, true, true);
		return next;

	}
	function openSubmenu(active) {
		active.jsMenuItem.selectSubmenu(active);
		menuNode = Menu._currentMenuNode;
		let next = nextItem(menuNode, null, true);
		if (next)
			next.jsMenuItem.select(next, true, false);
	}
	let menuNode = Menu._currentMenuNode
	if (menuNode) {
		let active = menuNode.activeItemNode;
		switch (e.keyCode) {
		case 27: // Escape
		case 37: // Left
			e.preventDefault();
			e.stopPropagation();
			if (e.keyCode == 37
			    && menuNode.jsMenu.menubarSubmenu
			    && nextMenu(menuNode, false))
				return;
			menuNode.jsMenu.popdown();
			break;
		case 13: // Enter
			e.preventDefault();
			e.stopPropagation();
			if (active) {
				if (active.jsMenuItem.submenu)
					openSubmenu(active);
				else
					active.jsMenuItem.doit(active);
			}
			break;
		case 39: // Right
			e.preventDefault();
			e.stopPropagation();
			if (active && active.jsMenuItem.submenu)
				openSubmenu(active);
			else if (Menu._topmostMenu.menubarSubmenu)
				nextMenu(menuNode, true);
			break;
		case 38: // Up
		case 40: // Down
			e.preventDefault();
			e.stopPropagation();
			let next = nextItem(menuNode,
					    menuNode.activeItemNode,
					    e.keyCode == 40);
			if (next)
				next.jsMenuItem.select(next, true, false);
			break;
		}
	}
}
Menu._keydownListening = false;
Menu._keydownListen = function(value) {
    if (value != Menu._keydownListening) {
        if (value)
            document.addEventListener('keydown', Menu._keydownListener, true);
        else
            document.removeEventListener('keydown', Menu._keydownListener, true);
    }
    Menu._keydownListening = value;
}

Menu._isMac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
			: typeof os != "undefined" ? os.platform() == "darwin" : false

class MenuItem {
	constructor(settings = {}) {


		const modifiersEnum = ['cmd', 'command', 'super', 'shift', 'ctrl', 'alt'];
		const typeEnum = ['separator', 'checkbox', 'radio', 'normal'];
		let type = isValidType(settings.type) ? settings.type : 'normal';
		let submenu = settings.submenu || null;
		let click = settings.click || null;
		let modifiers = validModifiers(settings.modifiers) ? settings.modifiers : null;
		let label = settings.label || '';

		let enabled = settings.enabled;
		if(typeof settings.enabled === 'undefined') enabled = true;
		let visible = settings.visible;
		if(typeof settings.visible === 'undefined') visible = true;
		let beforeShow = settings.beforeShow;

		Object.defineProperty(this, 'type', {
			get: () => {
				return type;
			}
		});

		Object.defineProperty(this, 'beforeShow', {
			get: () => {
				return beforeShow;
			}
		});

		Object.defineProperty(this, 'submenu', {
			get: () => {
				return submenu;
			},
			set: (inputMenu) => {
				console.warn('submenu should be set on initialisation, changing this at runtime could be slow on some platforms.');
				if(!(inputMenu instanceof Menu)) {
					console.error('submenu must be an instance of Menu');
					return;
				} else {
					submenu = inputMenu;
				}
			}
		});

		Object.defineProperty(this, 'click', {
			get: () => {
				return click;
			},
			set: (inputCallback) => {
				if(typeof inputCallback !== 'function') {
					console.error('click must be a function');
					return;
				} else {
					click = inputCallback;
				}
			}
		});

		Object.defineProperty(this, 'modifiers', {
			get: () => {
				return modifiers;
			},
			set: (inputModifiers) => {
				modifiers = validModifiers(inputModifiers) ? inputModifiers : modifiers;
			}
		});

		Object.defineProperty(this, 'enabled', {
			get: () => {
				return enabled;
			},
			set: (inputEnabled) => {
				enabled = inputEnabled;
			}
		});

		Object.defineProperty(this, 'visible', {
			get: () => {
				return visible;
			},
			set: (inputVisible) => {
				visible = inputVisible;
			}
		});

		Object.defineProperty(this, 'label', {
			get: () => {
				return label;
			},
			set: (inputLabel) => {
				label = inputLabel;
			}
		});

		this.icon = settings.icon || null;
		this.iconIsTemplate = settings.iconIsTemplate || false;
		this.tooltip = settings.tooltip || '';
		this.checked = settings.checked || false;

		this.key = settings.key || null;
		this.accelerator = settings.accelerator;
		this.node = null;

		if(this.key) {
			this.key = this.key.toUpperCase();
		}
		function validModifiers(modifiersIn = '') {
			let modsArr = modifiersIn.split('+');
			for(let i=0; i < modsArr; i++) {
				let mod = modsArr[i].trim();
				if(modifiersEnum.indexOf(mod) < 0) {
					console.error(`${mod} is not a valid modifier`);
					return false;
				}
			}
			return true;
		}

		function isValidType(typeIn = '', debug = false) {
			if(typeEnum.indexOf(typeIn) < 0) {
				if(debug) console.error(`${typeIn} is not a valid type`);
				return false;
			}
			return true;
		}
	}

	toString() {
		return this.type+"["+this.label+"]";
	}

	_mouseoverHandle_menubarTop() {
		let pmenu = this.node.jsMenuNode;
		if (pmenu.activeItemNode) {
			pmenu.activeItemNode.classList.remove('active');
			pmenu.activeItemNode = null;
		}
		if (pmenu && pmenu.querySelector('.submenu-active')) {
			if(this.node.classList.contains('submenu-active')) return;

			this.node.classList.add('submenu-active');
			this.select(this.node, true, true, true);
		}
	}

	doit(node) {
		if (! this.submenu) {
			Menu.popdownAll();
			if(this.type === 'checkbox')
				this.checked = !this.checked;
			else if (this.type === 'radio') {
				this.checked = true;
				for (let dir = 0; dir <= 1; dir++) {
					for (let n = node; ; ) {
						n = dir ? n.nextSibling
							: n.previousSibling;
						if (! (n instanceof Element
						       && n.classList.contains("radio")))
							break;
						n.jsMenuItem.checked = false;
					}
				}
			}
			if(this.click) this.click(this);
		}
	}

	select(node, turnOn, popupSubmenu, menubarSubmenu = false) {
		let pmenu = node.jsMenuNode;
		if (pmenu.activeItemNode) {
			pmenu.activeItemNode.classList.remove('active');
			pmenu.activeItemNode.classList.remove('submenu-active');
			pmenu.activeItemNode = null;
		}
		if(pmenu.currentSubmenu) {
			pmenu.currentSubmenu.popdown();
			pmenu.currentSubmenu = null;
		}
		if(this.submenu && popupSubmenu)
			this.selectSubmenu(node, menubarSubmenu);
		else
			node.classList.add('active');
		this.node.jsMenuNode.activeItemNode = this.node;
	}

	selectSubmenu(node, menubarSubmenu) {
		node.jsMenuNode.currentSubmenu = this.submenu;
		if(this.submenu.node)
			return;

		let parentNode = node.parentNode;
		let x, y;
		if (menubarSubmenu) {
			x = node.offsetLeft;
			y = node.clientHeight;
		} else {
			x = parentNode.offsetWidth + parentNode.offsetLeft - 2;
			y = parentNode.offsetTop + node.offsetTop - 4;
		}
		this.popupSubmenu(x, y, menubarSubmenu);
		node.classList.add('submenu-active');
	}

	buildItem(menuNode, menuBarTopLevel = false) {
		let node = document.createElement('li');
		node.jsMenuNode = menuNode;
		node.jsMenu = menuNode.jsMenu;
		node.jsMenuItem = this;
		node.classList.add('menu-item', this.type);

		menuBarTopLevel = menuBarTopLevel || this.menuBarTopLevel || false;
		this.menuBarTopLevel = menuBarTopLevel;

		if(menuBarTopLevel) {
			node.addEventListener('mouseenter', this._mouseoverHandle_menubarTop.bind(this));
		}

		let iconWrapNode = document.createElement('div');
		iconWrapNode.classList.add('icon-wrap');

		if(this.icon) {
			let iconNode = new Image();
			iconNode.src = this.icon;
			iconNode.classList.add('icon');
			iconWrapNode.appendChild(iconNode);
		}

		let labelNode = document.createElement('div');
		labelNode.classList.add('label');

		let modifierNode = document.createElement('div');
		modifierNode.classList.add('modifiers');

		let checkmarkNode = document.createElement('div');
		checkmarkNode.classList.add('checkmark');

		if(this.checked && !menuBarTopLevel)
			node.classList.add('checked');

		let text = '';

		if(this.submenu && !menuBarTopLevel) {
			text = '▶︎';

			node.addEventListener('mouseleave', (e) => {
				if(node !== e.target) {
					if(!Menu.isDescendant(node, e.target))
						this.submenu.popdown();
				}
			});
		}

		if(this.modifiers && !menuBarTopLevel) {
			if (MenuItem.useModifierSymbols) {
				let mods = this.modifiers.split('+');

				// Looping this way to keep order of symbols - required by macOS
				for(let symbol in MenuItem.modifierSymbols) {
					if(mods.indexOf(symbol) > -1) {
						text += MenuItem.modifierSymbols[symbol];
					}
				}
			} else
				text += this.modifiers + "+";
		}

		if(this.key && !menuBarTopLevel) {
			text += this.key;
		}
		if (this.accelerator && !menuBarTopLevel) {
			let acc = this.accelerator;
			let cmd = Menu._isMac ? "Cmd" : "Ctrl";
			acc = acc.replace("Command", "Cmd");
			acc = acc.replace("Control", "Ctrl");
			acc = acc.replace("CmdOrCtrl", cmd);
			acc = acc.replace("Mod+", cmd+"+");
			text += acc;
		}

		if(!this.enabled) {
			node.classList.add('disabled');
		}

		if(!menuBarTopLevel && this.type != 'separator') {
			node.addEventListener('mouseenter', () => {
				this.select(node, true, true);
			});
		}

		if(this.icon) labelNode.appendChild(iconWrapNode);

		let textLabelNode = document.createElement('span');
		textLabelNode.textContent = this.label;
		textLabelNode.classList.add('label-text');

		node.appendChild(checkmarkNode);

		labelNode.appendChild(textLabelNode);
		node.appendChild(labelNode);

		modifierNode.appendChild(document.createTextNode(text));
		node.appendChild(modifierNode);

		node.title = this.tooltip;
		this.node = node;
		menuNode.appendChild(node);
	}

	popupSubmenu(x, y, menubarSubmenu = false) {
		this.submenu.popup(x, y, this.node, menubarSubmenu);
		this.submenu.node.menuItem = this.node;
		this.node.jsMenuNode.currentSubmenu = this.submenu;
	}
}

MenuItem.modifierSymbols = {
	shift: '⇧',
	ctrl: '⌃',
	alt: '⌥',
	cmd: '⌘',
	super: '⌘',
	command: '⌘'
};

MenuItem.keySymbols = {
	up: '↑',
	esc: '⎋',
	tab: '⇥',
	left: '←',
	down: '↓',
	right: '→',
	pageUp: '⇞',
	escape: '⎋',
	pageDown: '⇟',
	backspace: '⌫',
	space: 'Space'
};
MenuItem.useModifierSymbols = Menu._isMac;

if (typeof module !== "undefined" && module.exports) {
	module.exports = { Menu: Menu, MenuItem: MenuItem };
}

// Local Variables:
// js-indent-level: 8
// indent-tabs-mode: t
// End:
