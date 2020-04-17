# Yume 2kki Explorer

Yume 2kki Explorer is a web app that uses Force Graph to display all worlds from the game along with their connections with eachother. The data can be displayed in different ways and routes between any pair of worlds can be calculated and visualized. Data used in this app is automatically updated from the Yume 2kki Wiki every hour with an additional full data refresh once per week.

## Graph

The graph will display worlds and their connections with icons attached to the connection links that show what type of connection the worlds have with eachother.

### Zoom Control

Mouse wheel

### Move Map

#### 2D Graph

Left click the background and drag

#### 3D Graph

Right click the background and drag

### Rotate Map (3D Mode Only)

Left click the background and drag

### Select a World Node

Left click

### Zoom Into a World Node

Left click on an already selected world node

### Open World Wiki Page

#### Open in New Tab

CTRL + left click on world node

**OR**

Right click on world node -> Open Wiki Page

#### Open in New Window

SHIFT + left click on world node

## Controls

### Search

Quickly find a world by searching for it by name. When searching, worlds not included in the results will become transparent. Selecting a world from the results will select and zoom into it.

### Origin and Destination

By selecting a world in both fields, the graph will load routes from the origin to the destination. If there are many routes, inefficient routes will be ignored. Note that connections of individual routes are color-coded from blue (shortest) to red (longest). Routes without locked connections will be prioritized.

You can also set a world as the origin or destination from the right click menu.

### Reset

Reload the graph while resetting your search, origin, and destination.

### Help

Load this documentation within the app in a modal window.

## Settings

Settings are accessible by clicking the arrow tab in the bottom center of the page.

### Language

Changes the app's language.

### UI Theme

Select the app's theme from the in-game menu themes.

### Font Style

Select the font's colour from the in-game font colors that belong to your current UI theme.

### Render Mode

Select whether to display the 2D or 3D version of the graph.

### Display Mode

This mode determines how worlds are organized visually in the graph. Each one has its advantages so be sure to try them all out.

### Connection Mode

Select whether to display connection icons for connections going backwards in depth. 'One-Way' will only display icons for connections that increase in depth.

### Label Display

Select when to show labels on world nodes.

### Size Difference

Select the size ratio between world nodes. The ratios are roughly based on the map sizes for maps belonging to each world.

### Stack Threshold

This setting determines the number of world nodes that make up a stack within the same depth level. A lower value will produce a taller graph and a higher value will produce a wider graph. This setting is only available in the 'Vertical' and 'Horizontal' display modes.