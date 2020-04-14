// Version 1.4.0 three-spritetext - https://github.com/vasturiano/three-spritetext
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('three')) :
  typeof define === 'function' && define.amd ? define(['three'], factory) :
  (global = global || self, global.SpriteText = factory(global.THREE));
}(this, (function (three$1) { 'use strict';

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function");
    }

    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: {
        value: subClass,
        writable: true,
        configurable: true
      }
    });
    if (superClass) _setPrototypeOf(subClass, superClass);
  }

  function _getPrototypeOf(o) {
    _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) {
      return o.__proto__ || Object.getPrototypeOf(o);
    };
    return _getPrototypeOf(o);
  }

  function _setPrototypeOf(o, p) {
    _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
      o.__proto__ = p;
      return o;
    };

    return _setPrototypeOf(o, p);
  }

  function _assertThisInitialized(self) {
    if (self === void 0) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }

    return self;
  }

  function _possibleConstructorReturn(self, call) {
    if (call && (typeof call === "object" || typeof call === "function")) {
      return call;
    }

    return _assertThisInitialized(self);
  }

  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread();
  }

  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr)) {
      for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

      return arr2;
    }
  }

  function _iterableToArray(iter) {
    if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter);
  }

  function _nonIterableSpread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance");
  }

  var three = window.THREE ? window.THREE // Prefer consumption from global THREE, if exists
  : {
    LinearFilter: three$1.LinearFilter,
    Sprite: three$1.Sprite,
    SpriteMaterial: three$1.SpriteMaterial,
    Texture: three$1.Texture
  };

  var _default = /*#__PURE__*/function (_three$Sprite) {
    _inherits(_default, _three$Sprite);

    function _default() {
      var _this;

      var text = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
      var textHeight = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 10;
      var color = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'rgba(255, 255, 255, 1)';

      _classCallCheck(this, _default);

      _this = _possibleConstructorReturn(this, _getPrototypeOf(_default).call(this, new three.SpriteMaterial({
        map: new three.Texture()
      })));
      _this._text = "".concat(text);
      _this._textHeight = textHeight;
      _this._color = color;
      _this._backgroundColor = false; // no background color

      _this._padding = 0;
      _this._borderWidth = 0;
      _this._borderColor = 'white';
      _this._fontFace = 'Arial';
      _this._fontSize = 90; // defines text resolution

      _this._strokeWidth = 0;
      _this._strokeColor = 'transparent';

      _this._fontWeight = 'normal';
      _this._canvas = document.createElement('canvas');
      _this._texture = _this.material.map;
      _this._texture.minFilter = three.LinearFilter;

      _this._genCanvas();

      return _this;
    }

    _createClass(_default, [{
      key: "_genCanvas",
      value: function _genCanvas() {
        var _this2 = this;

        var canvas = this._canvas;
        var ctx = canvas.getContext('2d');
        var border = Array.isArray(this.borderWidth) ? this.borderWidth : [this.borderWidth, this.borderWidth]; // x,y border

        var relBorder = border.map(function (b) {
          return b * _this2.fontSize * 0.1;
        }); // border in canvas units

        var padding = Array.isArray(this.padding) ? this.padding : [this.padding, this.padding]; // x,y padding

        var relPadding = padding.map(function (p) {
          return p * _this2.fontSize * 0.1;
        }); // padding in canvas units

        var lines = this.text.split('\n');
        var font = "".concat(this.fontWeight, " ").concat(this.fontSize, "px ").concat(this.fontFace);
        ctx.font = font; // measure canvas with appropriate font

        var innerWidth = Math.max.apply(Math, _toConsumableArray(lines.map(function (line) {
          return ctx.measureText(line).width;
        })));
        var innerHeight = this.fontSize * lines.length;
        canvas.width = innerWidth + relBorder[0] * 2 + relPadding[0] * 2;
        canvas.height = innerHeight + relBorder[1] * 2 + relPadding[1] * 2; // paint border

        if (this.borderWidth) {
          ctx.strokeStyle = this.borderColor;

          if (relBorder[0]) {
            ctx.lineWidth = relBorder[0] * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, canvas.height);
            ctx.moveTo(canvas.width, 0);
            ctx.lineTo(canvas.width, canvas.height);
            ctx.stroke();
          }

          if (relBorder[1]) {
            ctx.lineWidth = relBorder[1] * 2;
            ctx.beginPath();
            ctx.moveTo(relBorder[0], 0);
            ctx.lineTo(canvas.width - relBorder[0], 0);
            ctx.moveTo(relBorder[0], canvas.height);
            ctx.lineTo(canvas.width - relBorder[0], canvas.height);
            ctx.stroke();
          }
        }

        ctx.translate.apply(ctx, _toConsumableArray(relBorder)); // paint background

        if (this.backgroundColor) {
          ctx.fillStyle = this.backgroundColor;
          ctx.fillRect(0, 0, canvas.width - relBorder[0] * 2, canvas.height - relBorder[1] * 2);
        }

        ctx.translate.apply(ctx, _toConsumableArray(relPadding)); // paint text

        ctx.font = font; // Set font again after canvas is resized, as context properties are reset

        ctx.fillStyle = this.color;

        ctx.lineWidth = this.strokeWidth;
        ctx.strokeStyle = this.strokeColor;

        ctx.textBaseline = 'bottom';

        const drawTextStroke = this.strokeWidth && this.strokeColor !== 'transparent';

        lines.forEach(function (line, index) {
          if (drawTextStroke)
            ctx.strokeText(line, (innerWidth - ctx.measureText(line).width) / 2, (index + 1) * _this2.fontSize)
          return ctx.fillText(line, (innerWidth - ctx.measureText(line).width) / 2, (index + 1) * _this2.fontSize);
        }); // Inject canvas into sprite

        this._texture.image = canvas;
        this._texture.needsUpdate = true;
        var yScale = this.textHeight * lines.length + border[1] * 2 + padding[1] * 2;
        this.scale.set(yScale * canvas.width / canvas.height, yScale);
      }
    }, {
      key: "clone",
      value: function clone() {
        return new this.constructor(this.text, this.textHeight, this.color).copy(this);
      }
    }, {
      key: "copy",
      value: function copy(source) {
        three.Sprite.prototype.copy.call(this, source);
        this.color = source.color;
        this.backgroundColor = source.backgroundColor;
        this.padding = source.padding;
        this.borderWidth = source.borderWidth;
        this.borderColor = source.borderColor;
        this.fontFace = source.fontFace;
        this.fontSize = source.fontSize;
        this.fontWeight = source.fontWeight;
        this.strokeWidth = source.strokeWidth;
        this.strokeColor = source.strokeColor;
        return this;
      }
    }, {
      key: "text",
      get: function get() {
        return this._text;
      },
      set: function set(text) {
        this._text = text;

        this._genCanvas();
      }
    }, {
      key: "textHeight",
      get: function get() {
        return this._textHeight;
      },
      set: function set(textHeight) {
        this._textHeight = textHeight;

        this._genCanvas();
      }
    }, {
      key: "color",
      get: function get() {
        return this._color;
      },
      set: function set(color) {
        this._color = color;

        this._genCanvas();
      }
    }, {
      key: "backgroundColor",
      get: function get() {
        return this._backgroundColor;
      },
      set: function set(color) {
        this._backgroundColor = color;

        this._genCanvas();
      }
    }, {
      key: "padding",
      get: function get() {
        return this._padding;
      },
      set: function set(padding) {
        this._padding = padding;

        this._genCanvas();
      }
    }, {
      key: "borderWidth",
      get: function get() {
        return this._borderWidth;
      },
      set: function set(borderWidth) {
        this._borderWidth = borderWidth;

        this._genCanvas();
      }
    }, {
      key: "borderColor",
      get: function get() {
        return this._borderColor;
      },
      set: function set(borderColor) {
        this._borderColor = borderColor;

        this._genCanvas();
      }
    }, {
      key: "fontFace",
      get: function get() {
        return this._fontFace;
      },
      set: function set(fontFace) {
        this._fontFace = fontFace;

        this._genCanvas();
      }
    }, {
      key: "fontSize",
      get: function get() {
        return this._fontSize;
      },
      set: function set(fontSize) {
        this._fontSize = fontSize;

        this._genCanvas();
      }
    }, {
      key: "fontWeight",
      get: function get() {
        return this._fontWeight;
      },
      set: function set(fontWeight) {
        this._fontWeight = fontWeight;

        this._genCanvas();
      }
    }, {
      key: "strokeWidth",
      get: function get() {
        return this._strokeWidth;
      },
      set: function set(strokeWidth) {
        this._strokeWidth = strokeWidth;

        this._genCanvas();
      }
    }, {
      key: "strokeColor",
      get: function get() {
        return this._strokeColor;
      },
      set: function set(strokeColor) {
        this._strokeColor = strokeColor;

        this._genCanvas();
      }
    }]);

    return _default;
  }(three.Sprite);

  return _default;

})));
//# sourceMappingURL=three-spritetext.js.map
