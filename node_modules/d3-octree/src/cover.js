export default function(x, y, z) {
  if (isNaN(x = +x) || isNaN(y = +y) || isNaN(z = +z)) return this; // ignore invalid points

  var x0 = this._x0,
      y0 = this._y0,
      z0 = this._z0,
      x1 = this._x1,
      y1 = this._y1,
      z1 = this._z1;

  // If the octree has no extent, initialize them.
  // Integer extent are necessary so that if we later double the extent,
  // the existing octant boundaries don’t change due to floating point error!
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x)) + 1;
    y1 = (y0 = Math.floor(y)) + 1;
    z1 = (z0 = Math.floor(z)) + 1;
  }

  // Otherwise, double repeatedly to cover.
  else if (x0 > x || x > x1 || y0 > y || y > y1 || z0 > z || z > z1) {
    var t = x1 - x0,
        node = this._root,
        parent,
        i;

    switch (i = (z < (z0 + z1) / 2) << 2 | (y < (y0 + y1) / 2) << 1 | (x < (x0 + x1) / 2)) {
      case 0: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x1 = x0 + t, y1 = y0 + t, z1 = z0 + t, x > x1 || y > y1 || z > z1);
        break;
      }
      case 1: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x0 = x1 - t, y1 = y0 + t, z1 = z0 + t, x0 > x || y > y1 || z > z1);
        break;
      }
      case 2: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x1 = x0 + t, y0 = y1 - t, z1 = z0 + t, x > x1 || y0 > y || z > z1);
        break;
      }
      case 3: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x0 = x1 - t, y0 = y1 - t, z1 = z0 + t, x0 > x || y0 > y || z > z1);
        break;
      }
      case 4: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x1 = x0 + t, y1 = y0 + t, z0 = z1 - t, x > x1 || y > y1 || z0 > z);
        break;
      }
      case 5: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x0 = x1 - t, y1 = y0 + t, z0 = z1 - t, x0 > x || y > y1 || z0 > z);
        break;
      }
      case 6: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x1 = x0 + t, y0 = y1 - t, z0 = z1 - t, x > x1 || y0 > y || z0 > z);
        break;
      }
      case 7: {
        do parent = new Array(8), parent[i] = node, node = parent;
        while (t *= 2, x0 = x1 - t, y0 = y1 - t, z0 = z1 - t, x0 > x || y0 > y || z0 > z);
        break;
      }
    }

    if (this._root && this._root.length) this._root = node;
  }

  // If the octree covers the point already, just return.
  else return this;

  this._x0 = x0;
  this._y0 = y0;
  this._z0 = z0;
  this._x1 = x1;
  this._y1 = y1;
  this._z1 = z1;
  return this;
}
