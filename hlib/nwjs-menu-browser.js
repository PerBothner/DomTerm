(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["nwjsMenuBrowser"] = factory();
	else
		root["nwjsMenuBrowser"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// identity function for calling harmony imports with the correct context
/******/ 	__webpack_require__.i = function(value) { return value; };
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, {
/******/ 				configurable: false,
/******/ 				enumerable: true,
/******/ 				get: getter
/******/ 			});
/******/ 		}
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 3);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export (immutable) */ __webpack_exports__["a"] = isDescendant;
function isDescendant(parent, child) {
	var node = child.parentNode;
	while (node !== null) {
		if (node === parent) {
			return true;
		}
		node = node.parentNode;
	}
	return false;
}

/***/ }),
/* 1 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_0__menu__ = __webpack_require__(2);
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_1__is_decendant__ = __webpack_require__(0);
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_2__symbols__ = __webpack_require__(5);
var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }





var MenuItem = function () {
	function MenuItem() {
		var _this = this;

		var settings = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

		_classCallCheck(this, MenuItem);

		var modifiersEnum = ['cmd', 'command', 'super', 'shift', 'ctrl', 'alt'];
		var typeEnum = ['separator', 'checkbox', 'normal'];
		var type = isValidType(settings.type) ? settings.type : 'normal';
		var submenu = settings.submenu || null;
		var click = settings.click || null;
		var modifiers = validModifiers(settings.modifiers) ? settings.modifiers : null;
		var label = settings.label || '';

		var enabled = settings.enabled;
		if (typeof settings.enabled === 'undefined') enabled = true;
		var visible = settings.visible;
		if (typeof settings.visible === 'undefined') visible = true;

		if (submenu) {
			submenu.parentMenuItem = this;
		}

		Object.defineProperty(this, 'type', {
			get: function get() {
				return type;
			}
		});

		Object.defineProperty(this, 'submenu', {
			get: function get() {
				return submenu;
			},
			set: function set(inputMenu) {
				console.warn('submenu should be set on initialisation, changing this at runtime could be slow on some platforms.');
				if (!(inputMenu instanceof __WEBPACK_IMPORTED_MODULE_0__menu__["a" /* default */])) {
					console.error('submenu must be an instance of Menu');
					return;
				} else {
					submenu = inputMenu;
					submenu.parentMenuItem = _this;
				}
			}
		});

		Object.defineProperty(this, 'click', {
			get: function get() {
				return click;
			},
			set: function set(inputCallback) {
				if (typeof inputCallback !== 'function') {
					console.error('click must be a function');
					return;
				} else {
					click = inputCallback;
				}
			}
		});

		Object.defineProperty(this, 'modifiers', {
			get: function get() {
				return modifiers;
			},
			set: function set(inputModifiers) {
				modifiers = validModifiers(inputModifiers) ? inputModifiers : modifiers;
			}
		});

		Object.defineProperty(this, 'enabled', {
			get: function get() {
				return enabled;
			},
			set: function set(inputEnabled) {
				enabled = inputEnabled;
			}
		});

		Object.defineProperty(this, 'visible', {
			get: function get() {
				return visible;
			},
			set: function set(inputVisible) {
				visible = inputVisible;
			}
		});

		Object.defineProperty(this, 'label', {
			get: function get() {
				return label;
			},
			set: function set(inputLabel) {
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

		if (this.key) {
			this.key = this.key.toUpperCase();
		}
		function validModifiers() {
			var modifiersIn = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';

			var modsArr = modifiersIn.split('+');
			for (var i = 0; i < modsArr; i++) {
				var mod = modsArr[i].trim();
				if (modifiersEnum.indexOf(mod) < 0) {
					console.error(mod + ' is not a valid modifier');
					return false;
				}
			}
			return true;
		}

		function isValidType() {
			var typeIn = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
			var debug = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

			if (typeEnum.indexOf(typeIn) < 0) {
				if (debug) console.error(typeIn + ' is not a valid type');
				return false;
			}
			return true;
		}
	}

	_createClass(MenuItem, [{
		key: 'toString',
		value: function toString() {
			return this.type + "[" + this.label + "]";
		}
	}, {
		key: '_mouseoverHandle_menubarTop',
		value: function _mouseoverHandle_menubarTop() {
			var pmenu = this.parentMenu.node;
			if (pmenu.activeItemNode) {
				pmenu.activeItemNode.classList.remove('active');
				pmenu.activeItemNode = null;
			}
			if (pmenu && pmenu.querySelector('.submenu-active')) {
				if (this.node.classList.contains('submenu-active')) return;

				this.parentMenu.clearActiveSubmenuStyling(this.node);
				this.node.classList.add('submenu-active');
				this.select(this.node, true, true, true);
			}
		}
	}, {
		key: 'doit',
		value: function doit() {
			if (!this.submenu) {
				this.parentMenu.popdownAll();
				if (this.type === 'checkbox') this.checked = !this.checked;
				if (this.click) this.click(this);
			}
		}
	}, {
		key: 'select',
		value: function select(node, turnOn, popupSubmenu) {
			var menubarSubmenu = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

			var pmenu = this.parentMenu.node;
			if (pmenu.activeItemNode) {
				pmenu.activeItemNode.classList.remove('active');
				pmenu.activeItemNode = null;
			}
			if (pmenu.currentSubmenu) {
				pmenu.currentSubmenu.popdown();
				pmenu.currentSubmenu.parentMenuItem.node.classList.remove('submenu-active');
				pmenu.currentSubmenu = null;
			}
			if (this.submenu && popupSubmenu) this.selectSubmenu(node, menubarSubmenu);else node.classList.add('active');
			this.parentMenu.node.activeItemNode = this.node;
		}
	}, {
		key: 'selectSubmenu',
		value: function selectSubmenu(node, menubarSubmenu) {
			this.parentMenu.node.currentSubmenu = this.submenu;
			if (this.submenu.node) return;

			var parentNode = node.parentNode;
			var x = void 0,
			    y = void 0;
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
	}, {
		key: 'buildItem',
		value: function buildItem(menuNode) {
			var _this2 = this;

			var menuBarTopLevel = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

			var node = document.createElement('li');
			node.jsMenuNode = menuNode;
			node.jsMenu = menuNode.jsMenu;
			node.jsMenuItem = this;
			node.classList.add('menu-item', this.type);

			menuBarTopLevel = menuBarTopLevel || this.menuBarTopLevel || false;
			this.menuBarTopLevel = menuBarTopLevel;

			if (menuBarTopLevel) {
				node.addEventListener('mouseenter', this._mouseoverHandle_menubarTop.bind(this));
			}

			var iconWrapNode = document.createElement('div');
			iconWrapNode.classList.add('icon-wrap');

			if (this.icon) {
				var iconNode = new Image();
				iconNode.src = this.icon;
				iconNode.classList.add('icon');
				iconWrapNode.appendChild(iconNode);
			}

			var labelNode = document.createElement('div');
			labelNode.classList.add('label');

			var modifierNode = document.createElement('div');
			modifierNode.classList.add('modifiers');

			var checkmarkNode = document.createElement('div');
			checkmarkNode.classList.add('checkmark');

			if (!menuBarTopLevel) {
				if (this.checked) node.classList.add('checked');else node.classList.remove('checked');
			}

			var text = '';

			if (this.submenu && !menuBarTopLevel) {
				text = '▶︎';

				node.addEventListener('mouseleave', function (e) {
					if (node !== e.target) {
						if (!__webpack_require__.i(__WEBPACK_IMPORTED_MODULE_1__is_decendant__["a" /* default */])(node, e.target)) _this2.submenu.popdown();
					}
				});
			}

			if (this.modifiers && !menuBarTopLevel) {
				var mods = this.modifiers.split('+');

				// Looping this way to keep order of symbols - required by macOS
				for (var symbol in __WEBPACK_IMPORTED_MODULE_2__symbols__["a" /* modifierSymbols */]) {
					if (mods.indexOf(symbol) > -1) {
						text += __WEBPACK_IMPORTED_MODULE_2__symbols__["a" /* modifierSymbols */][symbol];
					}
				}
			}

			if (this.key && !menuBarTopLevel) {
				text += this.key;
			}
			if (this.accelerator && !menuBarTopLevel) {
				var acc = this.accelerator;
				var mac = false; // FIXME
				var cmd = mac ? "Cmd" : "Ctrl";
				acc = acc.replace("CommandOrControl", cmd);
				acc = acc.replace("Mod+", cmd + "+");
				text += acc;
			}

			if (!this.enabled) {
				node.classList.add('disabled');
			}

			if (!menuBarTopLevel) {
				node.addEventListener('mouseenter', function () {
					_this2.select(node, true, true);
				});
			}

			if (this.icon) labelNode.appendChild(iconWrapNode);

			var textLabelNode = document.createElement('span');
			textLabelNode.textContent = this.label;
			textLabelNode.classList.add('label-text');

			node.appendChild(checkmarkNode);

			labelNode.appendChild(textLabelNode);
			node.appendChild(labelNode);

			modifierNode.appendChild(document.createTextNode(text));
			node.appendChild(modifierNode);

			node.title = this.tooltip;
			this.node = node;
			return node;
		}
	}, {
		key: 'popupSubmenu',
		value: function popupSubmenu(x, y) {
			var menubarSubmenu = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

			this.submenu.popup(x, y, true, menubarSubmenu);
			this.submenu.node.menuItem = this.node;
			this.parentMenu.node.currentSubmenu = this.submenu;
		}
	}]);

	return MenuItem;
}();

/* harmony default export */ __webpack_exports__["a"] = (MenuItem);
// Local Variables:
// js-indent-level: 8
// indent-tabs-mode: t
// End:

/***/ }),
/* 2 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_0__menu_item__ = __webpack_require__(1);
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_1__is_decendant__ = __webpack_require__(0);
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_2__recursive_node_find__ = __webpack_require__(4);
var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }





var Menu = function () {
	function Menu() {
		var _this = this;

		var settings = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

		_classCallCheck(this, Menu);

		var typeEnum = ['contextmenu', 'menubar'];
		var items = [];
		var type = isValidType(settings.type) ? settings.type : 'contextmenu';

		Object.defineProperty(this, 'items', {
			get: function get() {
				return items;
			}
		});

		Object.defineProperty(this, 'type', {
			get: function get() {
				return type;
			},
			set: function set(typeIn) {
				type = isValidType(typeIn) ? typeIn : type;
			}
		});

		this.append = function (item) {
			if (!(item instanceof __WEBPACK_IMPORTED_MODULE_0__menu_item__["a" /* default */])) {
				console.error('appended item must be an instance of MenuItem');
				return false;
			}
			item.parentMenu = _this;
			var index = items.push(item);
			return index;
		};

		this.insert = function (item, index) {
			if (!(item instanceof __WEBPACK_IMPORTED_MODULE_0__menu_item__["a" /* default */])) {
				console.error('inserted item must be an instance of MenuItem');
				return false;
			}

			items.splice(index, 0, item);
			item.parentMenu = _this;
			return true;
		};

		this.remove = function (item) {
			if (!(item instanceof __WEBPACK_IMPORTED_MODULE_0__menu_item__["a" /* default */])) {
				console.error('item to be removed is not an instance of MenuItem');
				return false;
			}

			var index = items.indexOf(item);
			if (index < 0) {
				console.error('item to be removed was not found in this.items');
				return false;
			} else {
				items.splice(index, 0);
				return true;
			}
		};

		this.removeAt = function (index) {
			items.splice(index, 0);
			return true;
		};

		this.node = null;
		this.parentMenuItem = null;

		function isValidType() {
			var typeIn = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
			var debug = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

			if (typeEnum.indexOf(typeIn) < 0) {
				if (debug) console.error(typeIn + ' is not a valid type');
				return false;
			}
			return true;
		}
	}

	_createClass(Menu, [{
		key: 'createMacBuiltin',
		value: function createMacBuiltin() {
			console.error('This method is not available in browser :(');
			return false;
		}
	}, {
		key: 'popup',
		value: function popup(x, y) {
			var submenu = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
			var menubarSubmenu = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

			var menuNode = void 0;
			var setRight = false;

			submenu = submenu || this.submenu;
			this.submenu = menubarSubmenu;

			menubarSubmenu = menubarSubmenu || this.menubarSubmenu;
			this.menubarSubmenu = menubarSubmenu;
			if (!Menu._topmostMenu) {
				Menu._topmostMenu = this;
				var el = Menu.contextMenuParent || document.body;
				Menu._listenerElement = el;
				el.addEventListener('mouseup', Menu._mouseHandler, false);
				el.addEventListener('mousedown', Menu._mouseHandler, false);
			}

			if (this.node) {
				menuNode = this.node;
			} else {
				menuNode = this.buildMenu(submenu, menubarSubmenu);
				menuNode.jsMenu = this;
				this.node = menuNode;
			}
			Menu._currentMenuNode = menuNode;

			if (this.node.parentNode) {
				if (menuNode === this.node) return;
				this.node.parentNode.replaceChild(menuNode, this.node);
			} else {
				var _el = Menu.contextMenuParent || document.body;
				_el.appendChild(this.node);
			}

			var width = menuNode.clientWidth;
			var height = menuNode.clientHeight;

			if (x + width > window.innerWidth) {
				setRight = true;
				if (submenu) {
					var node = this.parentMenuItem.node;
					x = window.innerWidth - node.parentNode.offsetLeft + 2;
				} else {
					x = 0;
				}
			}

			if (y + height > window.innerHeight) {
				y = window.innerHeight - height;
			}

			if (!setRight) {
				menuNode.style.left = x + 'px';
				menuNode.style.right = 'auto';
			} else {
				menuNode.style.right = x + 'px';
				menuNode.style.left = 'auto';
			}

			menuNode.style.top = y + 'px';
			menuNode.classList.add('show');
		}
	}, {
		key: 'popdown',
		value: function popdown() {
			this.items.forEach(function (item) {
				if (item.submenu) {
					item.submenu.popdown();
				} else {
					item.node = null;
				}
			});
			if (this.node && this.type !== 'menubar') {
				Menu._currentMenuNode = this.node.parentMenuNode;
				if (this.menubarSubmenu) this.node.menuItem.classList.remove('submenu-active');
				this.node.parentNode.removeChild(this.node);
				this.node = null;
			}
			if (this.parentMenu == null) {
				Menu._topmostMenu = null;
				var el = Menu._listenerElement;
				if (el) {
					el.removeEventListener('mouseup', Menu._mouseHandler, false);
					el.removeEventListener('mousedown', Menu._mouseHandler, false);
					Menu._listenerElement = null;
				}
			}

			if (this.type === 'menubar') {
				this.clearActiveSubmenuStyling();
			}
		}
	}, {
		key: 'popdownAll',
		value: function popdownAll() {
			this.topmostMenu.popdown();
			return;
		}
	}, {
		key: 'buildMenu',
		value: function buildMenu() {
			var _this2 = this;

			var submenu = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
			var menubarSubmenu = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

			var menuNode = this.menuNode;
			if (submenu) menuNode.classList.add('submenu');
			if (menubarSubmenu) menuNode.classList.add('menubar-submenu');

			menuNode.jsMenu = this;
			menuNode.parentMenuNode = Menu._currentMenuNode;
			this.items.forEach(function (item) {
				item.parentMenu = _this2;
				if (item.visible) {
					var itemNode = item.buildItem(menuNode, _this2.type === 'menubar');
					menuNode.appendChild(itemNode);
				}
				//itemNode.jsMenu = this;
			});
			return menuNode;
		}
	}, {
		key: 'clearActiveSubmenuStyling',
		value: function clearActiveSubmenuStyling(notThisNode) {
			if (!this.node) return;
			var submenuActive = this.node.querySelectorAll('.submenu-active');
			var _iteratorNormalCompletion = true;
			var _didIteratorError = false;
			var _iteratorError = undefined;

			try {
				for (var _iterator = submenuActive[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
					var node = _step.value;

					if (node === notThisNode) continue;
					node.classList.remove('submenu-active');
				}
			} catch (err) {
				_didIteratorError = true;
				_iteratorError = err;
			} finally {
				try {
					if (!_iteratorNormalCompletion && _iterator.return) {
						_iterator.return();
					}
				} finally {
					if (_didIteratorError) {
						throw _iteratorError;
					}
				}
			}
		}
	}, {
		key: 'isNodeInChildMenuTree',
		value: function isNodeInChildMenuTree() {
			var node = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

			if (!node) return false;
			return __webpack_require__.i(__WEBPACK_IMPORTED_MODULE_2__recursive_node_find__["a" /* default */])(this, node);
		}
	}, {
		key: 'menuNode',
		get: function get() {
			var node = document.createElement('ul');
			node.classList.add('nwjs-menu', this.type);
			return node;
		}
	}, {
		key: 'parentMenu',
		get: function get() {
			if (this.parentMenuItem) {
				return this.parentMenuItem.parentMenu;
			} else {
				return undefined;
			}
		}
	}, {
		key: 'topmostMenu',
		get: function get() {
			var menu = this;

			while (menu.parentMenu) {
				if (menu.parentMenu) {
					menu = menu.parentMenu;
				}
			}

			return menu;
		}
	}], [{
		key: '_mouseHandler',
		value: function _mouseHandler(e) {
			var inMenubar = Menu._menubarNode != null && __webpack_require__.i(__WEBPACK_IMPORTED_MODULE_1__is_decendant__["a" /* default */])(Menu._menubarNode, e.target);
			var menubarHandler = e.currentTarget == Menu._menubarNode;
			var miNode = e.target;
			while (miNode && !miNode.jsMenuItem) {
				miNode = miNode.parentNode;
			} /* mouseenter:
          if selected sibling: unhighlight (and popdown if submenu)
          select item and if submenu popup
        mouseout (or mouseleave):
          if (! submenu) unhighlight
        mousedown:
        if (miNode) select
        else popdownAll
     */
			//console.log("HANDLE "+e.type+" inMB:"+inMenubar+" handler-t:"+e.currentTarget+" mbHandler:"+menubarHandler+" miNode:"+miNode);
			if (e.type == "mouseup") {
				/*
    if (miNode != null) {
    if active and not submenu: popdownAll and do click.
    if (active and submenu) as-is.
    if (! active) should not happen
    } else {
    do nothing
    }
    */
			}
			if (e.type == "mousedown" && !miNode) {
				if (Menu._topmostMenu) Menu._topmostMenu.popdownAll();
			}
			if (inMenubar == menubarHandler && miNode) {
				var item = miNode.jsMenuItem;
				if (e.type == "mousedown") {
					item.node.classList.toggle('submenu-active');
					// FIXME use select method
					if (item.submenu) {
						if (item.node.classList.contains('submenu-active')) {
							item.parentMenu.node.activeItemNode = item.node;
							item.popupSubmenu(item.node.offsetLeft, item.node.clientHeight, true);
						} else {
							item.submenu.popdown();
							item.parentMenu.node.currentSubmenu = null;
							item.parentMenu.node.activeItemNode = null;
						}
					}
				}
				if (e.type == "mouseup") {
					item.doit();
				}
			}
		}
	}, {
		key: 'setApplicationMenu',
		value: function setApplicationMenu(menubar) {
			var parent = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

			var oldNode = Menu._menubarNode;
			if (oldNode) {
				var _parent = oldNode.parentNode;
				if (_parent != null) _parent.removeChild(oldNode);
				newNode.removeEventListener('mousedown', Menu._mouseHandler, false);
				Menu._menubarNode = null;
			}
			if (menubar != null) {
				if (parent == null) parent = Menu._menubarParent || document.body;
				Menu._menubarParent = parent;
				var _newNode = menubar.buildMenu();
				_newNode.jsMenuItem = null;
				parent.insertBefore(_newNode, parent.firstChild);
				_newNode.addEventListener('mousedown', Menu._mouseHandler, false);
				Menu._menubarNode = _newNode;
				menubar.node = _newNode;
			}
			Menu._menubar = menubar;
		}
	}]);

	return Menu;
}();

// Parent node for context menu popup.  If null, document.body is the default.


Menu.contextMenuParent = null;

Menu._currentMenuNode = null;

Menu._keydownListener = function (e) {
	function nextItem(menuNode, curNode, forwards) {
		var nullSeen = false;
		var next = curNode;
		for (;;) {
			next = !next ? null : forwards ? next.nextSibling : next.previousSibling;
			if (!next) {
				next = forwards ? menuNode.firstChild : menuNode.lastChild;
				if (nullSeen || !next) return null;
				nullSeen = true;
			}
			if (next instanceof Element && next.classList.contains("menu-item") && !next.classList.contains("disabled")) return next;
		}
	}
	function nextMenu(forwards) {
		var menubarNode = nwjsMenuBrowser.Menu._topmostMenu.parentMenu.node;
		var next = nextItem(menubarNode, menubarNode.activeItemNode, forwards);
		if (next) next.jsMenuItem.select(next, true, true, true);
		return next;
	}
	var menuNode = Menu._currentMenuNode;
	if (menuNode) {
		var active = menuNode.activeItemNode;
		switch (e.keyCode) {
			case 27: // Escape
			case 37:
				// Left
				e.preventDefault();
				e.stopPropagation();
				if (e.keyCode == 37 && menuNode.jsMenu.menubarSubmenu && nextMenu(false)) return;
				menuNode.jsMenu.popdown();
				break;
			case 13:
				// Enter
				e.preventDefault();
				e.stopPropagation();
				if (active) active.jsMenuItem.doit();
				break;
			case 39:
				// Right
				e.preventDefault();
				e.stopPropagation();
				if (active && active.jsMenuItem.submenu) active.jsMenuItem.selectSubmenu(active);else if (Menu._topmostMenu.menubarSubmenu) nextMenu(true);
				break;
			case 38: // Up
			case 40:
				// Down
				e.preventDefault();
				e.stopPropagation();
				var next = nextItem(menuNode, menuNode.activeItemNode, e.keyCode == 40);
				if (next) next.jsMenuItem.select(next, true, false);
				break;
		}
	}
};
Menu._keydownListening = false;
Menu._keydownListen = function (value) {
	if (value != Menu._keydownListening) {
		if (value) document.addEventListener('keydown', Menu._keydownListener, true);else document.removeEventListener('keydown', Menu._keydownListener, true);
	}
	Menu._keydownListening = value;
};
Menu._keydownListen(true);

/* harmony default export */ __webpack_exports__["a"] = (Menu);
// Local Variables:
// js-indent-level: 8
// indent-tabs-mode: t
// End:

/***/ }),
/* 3 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
Object.defineProperty(__webpack_exports__, "__esModule", { value: true });
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_0__menu__ = __webpack_require__(2);
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_1__menu_item__ = __webpack_require__(1);
/* harmony reexport (binding) */ __webpack_require__.d(__webpack_exports__, "Menu", function() { return __WEBPACK_IMPORTED_MODULE_0__menu__["a"]; });
/* harmony reexport (binding) */ __webpack_require__.d(__webpack_exports__, "MenuItem", function() { return __WEBPACK_IMPORTED_MODULE_1__menu_item__["a"]; });





/* harmony default export */ __webpack_exports__["default"] = ({
	Menu: __WEBPACK_IMPORTED_MODULE_0__menu__["a" /* default */], MenuItem: __WEBPACK_IMPORTED_MODULE_1__menu_item__["a" /* default */]
});

/***/ }),
/* 4 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export (immutable) */ __webpack_exports__["a"] = recursiveNodeFind;
/* harmony import */ var __WEBPACK_IMPORTED_MODULE_0__is_decendant__ = __webpack_require__(0);


function recursiveNodeFind(menu, node) {
	if (menu.node === node) {
		return true;
	} else if (__webpack_require__.i(__WEBPACK_IMPORTED_MODULE_0__is_decendant__["a" /* default */])(menu.node, node)) {
		return true;
	} else if (menu.items.length > 0) {
		for (var i = 0; i < menu.items.length; i++) {
			var menuItem = menu.items[i];
			if (!menuItem.node) continue;

			if (menuItem.node === node) {
				return true;
			} else if (__webpack_require__.i(__WEBPACK_IMPORTED_MODULE_0__is_decendant__["a" /* default */])(menuItem.node, node)) {
				return true;
			} else {
				if (menuItem.submenu) {
					if (recursiveNodeFind(menuItem.submenu, node)) {
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

/***/ }),
/* 5 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "a", function() { return modifierSymbols; });
/* unused harmony export keySymbols */
var modifierSymbols = {
	shift: '⇧',
	ctrl: '⌃',
	alt: '⌥',
	cmd: '⌘',
	super: '⌘',
	command: '⌘'
};

var keySymbols = {
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



/***/ })
/******/ ]);
});