export default function(x) {
  if (isNaN(x = +x)) return this; // ignore invalid points

  var x0 = this._x0,
      x1 = this._x1;

  // If the binarytree has no extent, initialize them.
  // Integer extent are necessary so that if we later double the extent,
  // the existing half boundaries don’t change due to floating point error!
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x)) + 1;
  }

  // Otherwise, double repeatedly to cover.
  else if (x0 > x || x > x1) {
    var z = x1 - x0,
        node = this._root,
        parent,
        i;

    switch (i = +(x < (x0 + x1) / 2)) {
      case 0: {
        do parent = new Array(2), parent[i] = node, node = parent;
        while (z *= 2, x1 = x0 + z, x > x1);
        break;
      }
      case 1: {
        do parent = new Array(2), parent[i] = node, node = parent;
        while (z *= 2, x0 = x1 - z, x0 > x);
        break;
      }
    }

    if (this._root && this._root.length) this._root = node;
  }

  // If the binarytree covers the point already, just return.
  else return this;

  this._x0 = x0;
  this._x1 = x1;
  return this;
}
