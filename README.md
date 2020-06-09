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

### Author

By selecting an author, worlds by other authors will appear faded to emphasize the worlds created by the selected author.

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

### Routing Mode

Select the complexity to use when mapping paths between origin and destination world. More complex means more paths will be shown.

### Size Difference

Select the size ratio between world nodes. The ratios are roughly based on the map sizes for maps belonging to each world.

### Stack Threshold

This setting determines the number of world nodes that make up a stack within the same depth level. A lower value will produce a taller graph and a higher value will produce a wider graph. This setting is only available in the 'Vertical' and 'Horizontal' display modes.

---
# ゆめ２っきエクスプローラ

## マップツリー

このマップツリーでは、マップ間のつながりをアイコンで表示しています。

### ズーム

マウスホイール

### マップツリーを移動(2Dモード中)

背景を左クリックして、ドラッグ

### マップツリーを移動(3Dモード中)

背景を右クリックして、ドラッグ

### マップツリーを回転(3Dモード中)

背景を左クリックして、ドラッグ

### マップを選択

マップを左クリック

### 選択したマップへズーム

マップを左クリック長押し

### マップのwikiページを開く

#### マップのwikiページを新しいタブで開く

マップをCTRL + 左クリック　または　マップを右クリック

#### マップのwikiページを新しいウィンドウで開く

マップをSHIFT + 左クリック

## コントロール

### 検索

マップ名で検索すると、素早く目的のマップにたどり着くことができます。検索している間、目的のマップ以外は透明になります。検索結果からマップを選択すると、そのマップがズームインされます。

### ツクラー
ツクラーを選択すると、他のツクラーが制作したマップが薄く表示され、選択したツクラーが制作したマップが強調表示されます。

### ルート検索

二つのマップを選択することで、マップツリー上に現在地点から目的地までのルートが表示されます。ルートが多い場合は、効率の悪いルートは無視されます。個々のルートは、最短のもの（青色）から
最長のもの（赤色）まで色分けされています。接続がロックされていないルートが優先されます。
また、右クリックメニューから、マップを現在地点や目的地に設定することもできます。

### リセット

検索、現在地点、目的地をリセットし、マップツリーをリロードします。

### ヘルプ

ポップアップでこのテキストを表示します。

## 設定

ページ下部中央の矢印タブをクリックして、設定画面にアクセスします。

### 言語設定

言語を変更します。

### メニュータイプの設定

ゆめ2っきのメニュータイプから、メニュー画面の表示を変更します。

### フォントスタイルの設定

ゆめ2っきのメニュータイプから、フォントの色を変更します。

### レンダリングモードの設定

マップツリーを2Dで表示するか、3Dで表示するかを選びます。

### 表示モードの設定

どのようにマップツリーを構成するか選択します。自分に合った表示を探してみてください。

### 接続モードの設定

あまり効率的ではないルート（例：劇場→釈迦世界等、扉部屋に近づいてしまうもの）を表示するか、非表示にするかを選択します。
非効率的な一方通行（例：浮幽海→公園世界等）も同様に表示されなくなります。

### ラベル表示の調整

マップにラベルを表示するタイミングを設定します。

### ルート表示モード
現在地点から目的地までのルートを検索するときの、一度に表示するルート例の量を設定します。

### サイズ比の調整

各マップの表示サイズ比を選択します。比率に関しては、各マップの内部サイズを参照しています。

### スタック限界の調整

扉部屋からの距離が同じマップ間で、スタックを構成するマップの数を決定します。
値を小さくすると細長いマップツリーに、値を大きくすると幅広いマップツリーになります。
この設定は、表示モードが「垂直」か「水平」の時のみ有効です。
