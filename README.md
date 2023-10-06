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

### Version

By selecting a version, worlds unavailable in the selected version will appear faded to emphasize the worlds that are.

### Origin and Destination

By selecting a world in both fields, the graph will load routes from the origin to the destination. If there are many routes, inefficient routes will be ignored. Note that connections of individual routes are color-coded from blue (shortest) to red (longest). Routes without locked connections will be prioritized.

You can also set a world as the origin or destination from the right click menu.

### Reset

Reload the graph while resetting your search, origin, and destination.

### Help

Load this documentation within the app in a modal window.

## Side Menu

### Authors

Display a list of authors who have added worlds into the game. Hovering over an author will show you more information about the author. Clicking an author will enable a temporary filter to highlight that author's worlds on the graph. To disable this filter, simply click on an empty space on the graph or select 'All' on the author filter.

### Versions

Display a list of versions that have added, updated, or removed worlds. Hovering over a version will display more information about that update. Clicking the tab on the right of a version will show specific changes made in that version. Clicking a version will enable a temporary filter to highlight worlds affected by that version on the graph. To disable this filter, simply click on an empty space on the graph or select 'All' on the version filter.

### Effects

Display a list of available effects in a modal window. Hovering over an effect will show information from the Wiki on how to locate it. Clicking an effect will navigate to the world it's located in.

### Menu Themes

Display a list of available menu themes in a modal window. Hovering over a menu theme will show information from the Wiki on how to locate it. Clicking a menu theme will navigate to the world it's located in if applicable.

### Wallpapers

Display a list of available wallpapers in a modal window. Hovering over a wallpaper will show information from the Wiki on how to obtain it. Clicking a wallpaper will navigate to the world it's located in if applicable.

### Soundtrack

Display a list of available BGM tracks in a modal window. Hovering over a track will show information from the Wiki on where it is used. Clicking a track image will play the track and also navigate to the world it's located in if applicable. Clicking a track's play button will play the track in the audio player without navigating to the world or closing the modal. Clicking the button below a track's play button will add the track to the playlist. Tracks directly associated with a world will have a third button with an image icon and clicking this opens another modal window to select a screenshot of the world that best represents where the track is used. The image you choose will also be used for that track for everyone else using the app, so please only use it if you have a reasonable certainty that the current image for a track does not best represent where the track is used.

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

### Removed Content

Select whether to show removed worlds and connections.

### Routing Mode

Select the complexity to use when mapping paths between origin and destination world. More complex means more paths will be shown.

### Size Difference

Select the size ratio between world nodes. The ratios are roughly based on the map sizes for maps belonging to each world.

### Stack Threshold

This setting determines the number of world nodes that make up a stack within the same depth level. A lower value will produce a taller graph and a higher value will produce a wider graph. This setting is only available in the 'Vertical' and 'Horizontal' display modes.

---
# ゆめ２っきエクスプローラー

ゆめ２っきエクスプローラーは「Force Graph」を使った夢の世界のつながりを樹形図形式で表示するウェブアプリです。様々な表示方法にしたり、特定の世界までの道のりを検索し、わかりやすく表示したりできます。このアプリは英語のゆめ２っきWiki「yume.wiki」にあるデータを用いており、データ更新は一時間毎、データ置換が一週毎に行われます。

## マップツリー

マップツリーでは、世界間のつながりをアイコンで表示しています。

### ズーム

マウスホイール

### マップツリーを移動(レンダリングモードが2Dの時)

背景を左クリックして、ドラッグ

### マップツリーを移動(レンダリングモードが3Dの時)

背景を右クリックして、ドラッグ

### マップツリーを回転(レンダリングモードが3Dの時)

背景を左クリックして、ドラッグ

### 世界を選択

左クリック

### 選択した世界へズーム

選択した世界を再度左クリック

### wikiページを開く

#### Wikiページを新しいタブで開く

世界をCTRL + 左クリック　または 世界を右クリック

#### wikiページを新しいウィンドウで開く

世界をSHIFT + 左クリック

## コントロール

### 検索

世界名で検索すると、素早く目的の世界を見つけることができます。検索している間、目的のマップ以外は半透明になります。検索結果からマップを選択すると、そのマップが拡大表示されます。

### ツクラー

ツクラーを選択すると、他のツクラーが製作した世界は半透明になります。

### バージョン

バージョンを選択すると、選択していないバージョンの世界は半透明になります。

### ルート検索

二つの世界を入力することで、マップツリー上に出発地点から目的地までのルートが表示されます。ルートが多い場合は、効率の悪いルートは無視されます。個々のルートは、最短のもの（青色）から
最長のもの（赤色）に色分けされます。接続がロックされていないルートが優先されます。
また、右クリックメニューから、世界を出発地点や目的地に設定することもできます。

### リセット

検索、出発地点、目的地をリセットし、マップツリーをリロードします。

### ヘルプ

このテキストを表示します。

## 右側メニュー

### ツクラー

世界を製作したツクラーのリストを表示します。各項目にカーソルを合わせると詳細情報を確認できます。各項目をクリックすると、そのツクラーが製作した世界のみを表示するフィルターが一時的に設定されます（エクスプローラーに表示）。画面の何もない場所をクリック、もしくはツクラーフィルターで「全員」を選択するとフィルターを解除できます。

### バージョン

世界が追加、変更、および削除されたバージョンのリストを表示します。各項目にカーソルを合わせると詳細情報を確認できます。各項目の右側にあるタブをクリックすると、そのバージョンでの変更点のリストを表示します。各項目をクリックすると、そのバージョンで変更があった世界を表示するフィルターが一時的に設定されます（エクスプローラーに表示）。画面の何もない場所をクリック、もしくはバージョンフィルターで「全バージョン」を選択するとフィルターを解除できます。

### エフェクト

エフェクトのリストを表示します。各項目にカーソルを合わせると、エフェクトがある場所を表示します。各項目をクリックすると、エフェクトがある場所までの道のりを表示します（エクスプローラーに表示）。

### メニュータイプ

メニュータイプのリストを表示します。各項目にカーソルを合わせると、メニュータイプの取得方法を表示します。各項目をクリックすると、メニュータイプがある場所までの道のりを表示します（エクスプローラーに表示）。

### パソコンの壁紙

パソコンの壁紙のリストを表示します。各項目にカーソルを合わせると、壁紙の取得方法を表示します。各項目をクリックすると、壁紙を取得できる場所までの道のりを表示します（エクスプローラーに表示）。

### SR分室の曲

SR分室の曲のリストを表示します。 各項目にカーソルを合わせるとその曲の情報と使われた場所を表示します。特定のマップで流れる曲には、画像アイコンが付いた３つ目のボタンがあり、クリックするとその曲が使われた世界のスクリーンショット一覧が表示されます。選択した画像は、エクスプローラーを使用している他のユーザーにも適用されますので、その曲が現在の画像の場所では使われていないという確信がある場合にのみ、この機能を使用してください。

## 設定

ページ中央下部の矢印タブをクリックすると、設定画面を開きます。

### 言語

言語の変更ができます。

### アプリのメニュータイプ

アプリのメニュータイプの変更ができます。ゆめ２っきで使われているメニュータイプから選択できます。

### フォントスタイル

フォントの色の変更ができます。アプリのメニュータイプで選んだメニュータイプに基づくフォントの色から選択できます。

### レンダリングモード

マップツリーの表示方法の変更ができます。２Ｄ もしくは ３Ｄ から選択できます。

### ディスプレイモード

どのようにマップツリーを構成するかを選択できます。自分に合った表示方法を探してみてください。

### 接続情報表示

各世界の接続方法や条件の表示を片方向、もしくは両方向にするかを選択できます。
片方向の場合、深度が深い世界への接続方法や条件のみを表示します。

### ラベル表示

世界に世界名のラベルを表示するタイミングを設定できます。

### 古いデータ

削除された世界や接続の表示を設定できます。

### ルート表示モード
出発地点から目的地までのルートを検索するときの、一度に表示するルートの量を設定できます。

### サイズ比の調整

各マップの表示サイズ比を設定できます。比率に関しては、各マップの大きさに準じています。

### スタック量の調整

深度が同じマップの、スタックを構成するマップの数を設定できます。
値を小さくすると細長いマップツリーに、値を大きくすると幅広いマップツリーになります。
この設定は、ディスプレイモードが「縦」か「横」の時のみ有効です。

---
# Yume 2kki Explorer
Yume 2kki Explorer 는 포스 그래프 형식으로 게임 내의 모든 맵과 맵들 간의 연결을 보여주는 웹 앱입니다. 그래프 데이터는 사용자가 설정함에 따라 다른 방식으로 표시할 수 있으며, 또한 두 맵들 사이의 경로들을 계산하고 시각화할 수 있습니다. 이 앱에 사용된 데이터는 유메2키 위키에서 매시간마다 자동으로 업데이트되며, 매주 한 번씩 전체 데이터 새로 고침이 추가로 수행됩니다.

## 그래프
그래프는 맵들과 맵 사이 연결점을 표시해줍니다. 연결 고리에 부착된 아이콘은 해당 맵들 사이에 어떤 종류의 연결을 이루고 있는지 나타냅니다.

### 줌 인/줌 아웃
마우스 휠

### 그래프 움직이기
#### 2D 그래프일 경우
좌클릭으로 빈 공간을 누른 상태에서 드래그

#### 3D 그래프일 경우
우클릭으로 빈 공간을 누른 상태에서 드래그

#### 그래프 회전 (3D 그래프에서만 가능)
좌클릭으로 빈 공간을 누른 상태에서 드래그

### 맵 선택하기
좌클릭

### 선택한 맵으로 줌 인 하기
선택한 상태에서 좌클릭 한번 더 누르기

### 맵 위키 페이지 열기
#### 새 탭에서 열기
맵 아이콘을 Ctrl키를 누른 상태에서 좌클릭 하기

또는

맵 아이콘을 우클릭 한 후 위키 페이지 열기 항목 선택

#### 새 창에서 열기
맵 아이콘을 Shift키를 누른 상태에서 좌클릭 하기

## 필터
앱 기준에서 가장 위쪽에 위치한 항목입니다.

### 검색
이름으로 검색하여 빠르게 맵을 찾습니다. 검색할 때 결과에 포함되지 않은 맵은 투명해지며, 검색 결과를 클릭하면 맵이 선택되고 줌 인이 됩니다.

### 제작자
작가를 선택하면 검색 결과에 포함되지 않은 작가들의 맵들은 투명 처리하고, 선택된 작가가 만든 맵들을 더 눈에 띄게합니다.

### 버전
버전을 선택하면 선택한 버전에서 진입할 수 없는 맵들을 투명 처리하고, 해당 버전에 존재하는 맵들을 더 눈에 띄게 합니다.

### 출발지와 도착지
두 항목에 해당하는 맵들을 모두 설정하면 그래프가 출발지에서 목적지까지의 경로를 로드합니다. 노선이 많으면 비효율적인 노선은 표시되지 않을 수 있습니다. 각 경로의 노선은 파란색(가장 짧음)에서 빨간색(가장 긴)으로 색상으로 구분됩니다. 특정한 조건이 필요 없거나 잠기지 않은 노선들이 우선적으로 표시됩니다.

마우스 오른쪽 버튼 메뉴에서 해당 맵을 출발지 또는 도착지로 설정할 수도 있습니다.

### 리셋
검색 결과, 출발지, 도착지 데이터를 초기화 합니다.

### 도움말
앱에서 이 문서가 담긴 창을 띄웁니다.

## 사이드 메뉴
앱 기준 오른쪽에 위치하며, 설정 항목을 열고 닫을 수 있습니다.

### 제작자
제작자가 추가한 맵의 목록을 표시합니다. 제작자 항목 위에 마우스를 올리면 제작자에 대한 자세한 정보가 표시됩니다. 제작자를 누르면 그래프에서 제작자의 맵을 강조 표시하는 임시 필터가 활성화됩니다. 이 필터를 비활성화하려면 그래프의 빈 공간을 클릭하거나 제작자 필터에서 '전체'를 선택하면 됩니다.

### 버전
맵을 추가, 업데이트 또는 제거한 버전 목록을 표시합니다. 버전 위에 마우스를 올리면 해당 업데이트에 대한 추가 정보가 표시됩니다. 버전 오른쪽에 있는 탭을 클릭하면 해당 버전에서 변경된 내용이 표시됩니다. 버전을 클릭하면 임시 필터가 적용되고, 그래프에서 해당 버전의 영향을 받는 맵들을 강조 표시할 수 있습니다. 이 필터를 비활성화하려면 그래프의 빈 공간을 클릭하거나 버전 필터에서 '전체'를 선택하시면 됩니다.

### 이펙트
취득 가능한 이펙트들의 목록을 표시합니다. 이펙트 위에 마우스를 올리면 위키에 있는 취득 방법에 대한 정보가 표시됩니다. 이펙트를 클릭하면 이펙트가 위치하고 있는 맵을 보여줍니다.

### 메뉴 테마
취득 가능한 메뉴 테마들의 목록을 표시합니다. 메뉴 테마 위에 마우스를 놓으면 찾는 방법에 대한 위키에 기술된 정보가 표시됩니다. 메뉴 테마가 특정한 맵에서 취득 가능할 경우 해당 메뉴 테마를 클릭하면 위치하고 있는 맵을 보여줍니다.

### 배경화면
취득 가능한 배경화면 목록을 표시합니다. 배경화면 위에 마우스를 올리면 위키에 적혀있는 얻는 방법에 대한 정보가 표시됩니다. 취득 조건이 특정 맵과 연관이 있는 경우 배경화면을 클릭하면 해당 배경화면이 있는 맵을 보여줍니다.

### 사운드트랙
수집 가능한 사운드트랙 목록을 보여줍니다. 트랙 위에 마우스를 올리면 해당 트랙이 사용되고 있는 맵의 정보를 표시합니다. 트랙 이미지를 클릭하면 트랙이 재생되고 해당 음악을 사용하고 있는 맵을 보여줍니다. 트랙의 재생 버튼을 클릭하면 목록 창을 닫거나 맵으로 이동하지 않고 오디오 플레이어에서 트랙이 재생됩니다. 트랙의 재생 버튼 아래에 있는 버튼을 클릭하면 트랙이 재생 목록에 추가됩니다. 맵과 직접 연결된 트랙에는 이미지 아이콘이 있는 세 번째 버튼이 있으며, 이 버튼을 클릭하면 트랙이 사용되는 곳을 가장 잘 나타내는 맵 스크린샷을 선택할 수 있는 또 다른 창이 열립니다. 선택한 이미지는 앱을 사용하는 다른 모든 사람에게도 해당 트랙에 영향을 미치기 때문에 트랙의 현재 이미지가 트랙이 사용되는 위치를 가장 잘 나타내지 않는다는 합리적인 확신이 있는 경우에만 사용해주세요.

## 설정
앱 중앙 하단에 있는 탭을 클릭하여 설정 항목을 열 수 있습니다.

### 언어
앱의 언어를 변경합니다.

### UI 테마
앱의 UI 테마를 게임 내 메뉴 테마 중 하나로 선택하여 변경할 수 있습니다.

### 폰트 스타일
현재 UI 테마에 속하는 폰트의 색상을 선택할 수 있습니다.

### 렌더링 모드
그래프를 2D 버전으로 나타낼 것인지, 3D 버전으로 나타낼 것인지 선택할 수 있습니다.

### 정렬 모드
해당 설정은 연결된 맵들을 나타내는 그래프 자체의 구성을 시각적으로 변경할 수 있습니다. 각자 장점이 있으니 각 항목을 꼭 한 번씩 확인해보고 설절해주세요.

### 연결 모드
깊이가 다른 맵들 사이의 연결에서의 연결 아이콘들을 어떻게 표시할 것인지 선택할 수 있습니다. '단방향'은 깊이가 증가하는 연결에 대한 아이콘만 표시합니다.

### 맵 이름 표시
맵 아이콘 위에 보여지는 이름 정보를 어떤 식으로 보이게 할 지 설정할 수 있습니다.

### 삭제된 맵
삭제된 맵과 그 사이의 연결을 표시할 것인지 정할 수 있습니다.

### 경로 모드
출발지와 도착지 맵 간의 경로를 표시할 때 사용할 복잡성을 선택할 수 있습니다. '자세히'를 선택하면 경로가 더 많이 표시됩니다.

### 크기 차이 정도
맵 간의 크기 비율을 선택할 수 있습니다. 비율은 대략 각 맵에 속하는 지도의 크기를 기반으로 합니다.

### 월드 분포 정도
이 설정은 동일한 깊이 수준의 맵들을 놓는 방법을 정할 수 있습니다. 값이 낮을수록 그래프가 좁아지고 값이 높을수록 그래프가 넓어집니다. 이 설정은 '수직' 및 '수평' 정렬 모드에서만 사용할 수 있습니다.

---
# Yume 2kki Explorer

Yume 2kki Explorer - Это веб-приложение, использующее Force Graph (Граф) для отображения всех миров игры и их соединений друг с другом. Данные могут быть отображены по-разному, возможно построить и визуализировать маршруты между любой парой миров. Данные, используемые в приложении, автоматически обновляются с Yume 2kki Wiki каждый час, а так-же дополнительно перезагружаются полностью каждую неделю.

## Граф

Графом отображаются миры и их соединения, с иконками у соединений, обозначающими, как именно соединяются миры друг с другом.

### Управление Уровнем Приближения

Колёсиком мыши.

### Передвижение карты

#### 2D Граф

Кликнуть левой кнопкой мыши по фону и перетащить.

#### 3D Граф

Кликнуть правой кнопкой мыши по фону и перетащить.

### Вращение карты (Только в режиме 3D)

Кликнуть левой кнопкой мыши по фону и перетащить.

### Выбор узла-Мира

Клик левой кнопкой мыши.

### Приблизить к Узлу-Миру

Клик левой кнопкой мыши по уже выбранному узлу-Миру.

### Открыть страницу Мира на Вики

#### Открыть в Новой Вкладке

CTRL + Клик левой кнопки мыши по узлу-Миру.

**ИЛИ**

Клик правой кнопки мыши по узлу-Миру -> Просмотреть страницу Вики

#### Открыть в Новом Окне

SHIFT + Клик левой кнопки мыши по узлу-Миру.

## Управление

### Поиск

Быстрый поиск мира по его названию. Во время поиска, миры, не подходящие под запрос, станут прозрачными. После выбора мира из результатов поиска он будет выбран на графе и приближен.

### Авторы

После выбора определённого автора, миры от других авторов станут полупрозрачными, выделяя таким образом созданные выбранным автором.

### Версии

После выбора определённой версии, миры, недоступные в выбранной версии, станут полупрозрачными, выделяя таким образом доступные.

### Откуда и Куда

Выбрав по миру в обеих полях, граф отобразит маршруты из Точки Отправления (Откуда) в Точку Назначения (Куда). Если существует несколько путей, неэффективные маршруты будут проигнорированы. Помните, что соединения каждого маршрута обозначены цветами от синего (кратчайший) к красному (длиннейший). Маршруты без закрытых соединений будут в приоритете.

Вы так-же можете назначить мир Точками Отправления или Назначения из меню, открываемого Правым кликом по узлу-Миру.

### Сброс

Перезагружает граф, сбрасывая ваш ввод поиска и точек отправления и назначения.

### Помощь

Открыть это окно.

## Боковое меню

### Авторы 

Отображает список авторов, добавивших свои миры в игру. При наведении на автора будет показано больше информации о нём/ней. При нажатии на автора временно включится фильтр, подсвечивающий его миры на графе. Для отключения фильтра, просто кликните на пустое место на графе или выберите "Все" в списке фильтров по авторам.

### Версии

Отображает список версий, в которых были добавлены, обновлены или удалены миры. При наведении на версию будет показана информация о данном обновлении. При нажатии на вкладку справа от версии будут показаны конкретные изменения, что произошли в ней. При нажатии на версию временно включится фильтр, подсвечивающий миры, которые эта версия так или иначе затронула. Для отключения фильтра, просто кликните на пустое место на графе или выберите "Все" в списке фильтров по версиям.

### Эффекты

Отображает список имеющихся в игре эффектов во всплывающем окне. При наведении на эффект будет показана информация с Вики о том, Как его получить. При нажатии на эффект вас перенесёт на графе к миру, в котором Эффект расположен.

### Стили Меню

Отображает список доступных Стилей Меню во всплывающем окне. При наведении на стиль меню будет показана информация с Вики о том, Как его получить. При нажатии на Стиль меню вас перенесёт на графе к миру, в котором Стиль расположен, если это в его случае применимо.

### Обои

Отображает список доступных обоев во всплывающем окне. При наведении на обои будет показана информация с Вики о том, Как их получить. При нажатии на Обои вас перенесёт на графе к миру, в котором их можно найти, если это понятие в их случае применимо.

### Треки

Отображает список доступных треков во всплывающем окне. При наведении на трек будет показана информация с Вики о том, Где он используется. При нажатии на картинку трека он будет проигран и на графе будет показано, где он используется, если это в его случае применимо. При нажатии на кнопку воспроизведения трека он будет проигран в плеере без перемещения по графу и закрытия всплывающего окна. При нажатии на кнопку под той, что расположена под кнопкой проигрывания трека, он будет добавлен в плейлист. Треки напрямую связанные с миром имеют третью кнопку с иконкой картинки, при нажатии которой всплывает другое окошко для выбора скриншота мира, лучше всего передающего, где трек используется. Выбранный вами скриншот так-же будет использоваться для отображения этого трека у других пользователей приложения, а потому, пожалуйста, используйте эту функцию Только если вы абсолютно уверены, что нынешняя обложка трека не достаточно достоверно отображает, Где трек используется.

## Настройки

Настройки доступны по нажатию вкладки со стрелкой внизу в центре страницы.

### Язык

Переключает язык приложения.

### Стиль Интерфейса

Выберите стиль интерфейса приложения из списка стилей меню игры.

### Стиль Шрифта

Выберите цвет шрифта из списка внутриигровых цветов шрифта, поставляющихся с вашим Стилем Интерфейса.

### Режим Отрисовки

Выберите, какую версию графа следует отрисовывать: 2D (Плоскую) или 3D (Объёмную).

### Режим отображения

Эта настройка изменяет то, Как миры визуально организованны на графе. У каждого режима есть свои преимущества, потому не забудьте опробовать их все.

### Отображение соединений

Выберите, отображать-ли иконки для соединений, идущих по глубине в обратном направлении. "Одностороннее" будет отображать иконки только для соединений, идущих вглубь (По нарастанию глубины).

### Отображение названий

Выберите когда отображать названия на узлах-Мирах.

### Удалённый контент

Выберите, показывать-ли удалённые миры и соединения.

### Режим построения маршрута

Выберите, какой сложности будут строиться маршруты между Точкой отправления и Точкой назначения. Чем выше сложность, тем больше путей будет показано.

### Разница в размерах

Выберите соотношение размеров между узлами-Мирами. Соотношения примерно соответствуют размерам карт каждого из миров.

### Высота/Широта

От этой настройки зависит, насколько плотно миры группируются на одном уровне глубины. Чем ниже значение, тем выше граф. Чем выше значение, тем шире граф. Эта настройка доступна только в "Вертикальном" и "Горизонтальном" режимах отображения.
