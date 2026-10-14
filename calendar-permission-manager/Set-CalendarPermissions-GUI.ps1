#Requires -Version 5.1
# ──────────────────────────────────────────────────────────────────────────────
# M365 Calendar Permission Manager  –  WPF GUI
# Requires: ExchangeOnlineManagement module  (run install-dependencies.bat)
# ──────────────────────────────────────────────────────────────────────────────

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue

# ── XAML layout ───────────────────────────────────────────────────────────────
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="M365 Calendar Permission Manager"
        Width="660" Height="860"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterScreen"
        Background="#f4f6fb"
        FontFamily="Segoe UI" FontSize="14">
  <Window.Resources>

    <Style TargetType="Label">
      <Setter Property="Foreground" Value="#374151"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Padding" Value="0,6,0,3"/>
    </Style>

    <Style TargetType="TextBox">
      <Setter Property="Background" Value="#ffffff"/>
      <Setter Property="Foreground" Value="#111827"/>
      <Setter Property="BorderBrush" Value="#9ca3af"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="8,6"/>
      <Setter Property="Height" Value="34"/>
      <Setter Property="FontSize" Value="13"/>
    </Style>

    <Style TargetType="ComboBox">
      <Setter Property="Background" Value="#ffffff"/>
      <Setter Property="Foreground" Value="#111827"/>
      <Setter Property="BorderBrush" Value="#9ca3af"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Height" Value="34"/>
      <Setter Property="Padding" Value="8,4"/>
      <Setter Property="FontSize" Value="13"/>
    </Style>

    <Style TargetType="CheckBox">
      <Setter Property="Foreground" Value="#374151"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Margin" Value="0,5,24,5"/>
      <Setter Property="VerticalContentAlignment" Value="Center"/>
    </Style>

    <Style TargetType="Button">
      <Setter Property="Background" Value="#2563eb"/>
      <Setter Property="Foreground" Value="#ffffff"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Padding" Value="14,7"/>
      <Setter Property="Height" Value="36"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>

    <Style TargetType="GroupBox">
      <Setter Property="Foreground" Value="#1e40af"/>
      <Setter Property="BorderBrush" Value="#d1d5db"/>
      <Setter Property="Background" Value="#ffffff"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Margin" Value="0,8,0,0"/>
      <Setter Property="Padding" Value="12,10"/>
    </Style>

  </Window.Resources>

  <StackPanel Margin="20,16,20,16">

    <!-- Header -->
    <StackPanel Margin="0,0,0,6">
      <TextBlock Text="M365 Calendar Permission Manager"
                 FontSize="20" FontWeight="Bold" Foreground="#1e3a8a"/>
      <TextBlock Text="Grant or remove calendar permissions across Exchange Online mailboxes"
                 FontSize="12" Foreground="#6b7280" Margin="0,3,0,0"/>
    </StackPanel>

    <!-- Connection -->
    <GroupBox Header="  Connection">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="120"/>
        </Grid.ColumnDefinitions>
        <StackPanel Grid.Column="0">
          <Label Content="Admin UPN"/>
          <TextBlock Text="Your Exchange or Global Admin account used to connect to Exchange Online."
                     FontSize="11" Foreground="#6b7280" TextWrapping="Wrap" Margin="0,0,0,5"/>
          <Grid>
            <TextBox x:Name="txtAdminUPN"/>
            <TextBlock x:Name="txtAdminUPNPlaceholder"
                       Text="admin@domain.com"
                       Foreground="#9ca3af" FontSize="13"
                       Margin="10,0,0,0" VerticalAlignment="Center"
                       IsHitTestVisible="False"/>
          </Grid>
          <TextBlock x:Name="lblUpnHint" FontSize="11" Margin="0,3,0,0" Visibility="Collapsed"/>
        </StackPanel>
        <Button x:Name="btnConnect" Content="Connect"
                Grid.Column="1" Margin="12,26,0,0" VerticalAlignment="Bottom"/>
      </Grid>
    </GroupBox>

    <!-- Target -->
    <GroupBox Header="  Target Mailboxes">
      <StackPanel>
        <Label Content="Scope"/>
        <ComboBox x:Name="cmbScope">
          <ComboBoxItem Content="All User Mailboxes" IsSelected="True"/>
          <ComboBoxItem Content="All User + Shared Mailboxes"/>
          <ComboBoxItem Content="Specific Domain(s) in tenant"/>
          <ComboBoxItem Content="Specific UPNs (comma-separated)"/>
          <ComboBoxItem Content="Import from CSV file"/>
        </ComboBox>
        <TextBox x:Name="txtDomains" Margin="0,8,0,0"
                 ToolTip="e.g. contoso.com, fabrikam.com"
                 Visibility="Collapsed"/>
        <Grid x:Name="gridSpecificUPNs" Margin="0,8,0,0" Visibility="Collapsed">
          <TextBox x:Name="txtSpecificUPNs"/>
          <TextBlock x:Name="txtSpecificUPNsPlaceholder"
                     Text="calendar owner(s) whose calendar to configure"
                     Foreground="#9ca3af" FontSize="12" FontStyle="Italic"
                     Margin="10,0,0,0" VerticalAlignment="Center"
                     IsHitTestVisible="False"/>
        </Grid>
        <Grid Margin="0,8,0,0" x:Name="gridCSV" Visibility="Collapsed">
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="*"/>
            <ColumnDefinition Width="100"/>
          </Grid.ColumnDefinitions>
          <TextBox x:Name="txtCSVPath" IsReadOnly="True"
                   ToolTip="CSV must have a column named UPN, Mail, or SMTP"/>
          <Button x:Name="btnBrowse" Content="Browse..."
                  Grid.Column="1" Margin="8,0,0,0" Background="#6b7280"/>
        </Grid>
      </StackPanel>
    </GroupBox>

    <!-- Permissions -->
    <GroupBox Header="  Permission Settings">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="20"/>
          <ColumnDefinition Width="*"/>
        </Grid.ColumnDefinitions>
        <StackPanel Grid.Column="0">
          <Label Content="Grant permissions TO"/>
          <ComboBox x:Name="cmbGrantTo">
            <ComboBoxItem Content="Default (all org users)" IsSelected="True"/>
            <ComboBoxItem Content="Specific user (UPN)"/>
          </ComboBox>
          <Grid x:Name="gridGrantToUser" Margin="0,8,0,0" Visibility="Collapsed">
            <TextBox x:Name="txtGrantToUser"/>
            <TextBlock x:Name="txtGrantToUserPlaceholder"
                       Text="who gets access e.g. assistant@company.com"
                       Foreground="#9ca3af" FontSize="12" FontStyle="Italic"
                       Margin="10,0,0,0" VerticalAlignment="Center"
                       IsHitTestVisible="False"/>
          </Grid>
        </StackPanel>
        <StackPanel Grid.Column="2">
          <Label Content="Access level"/>
          <ComboBox x:Name="cmbAccess">
            <ComboBoxItem Content="Editor" IsSelected="True"/>
            <ComboBoxItem Content="Reviewer (read-only)"/>
            <ComboBoxItem Content="Author"/>
            <ComboBoxItem Content="PublishingEditor"/>
            <ComboBoxItem Content="Owner (full control)"/>
            <ComboBoxItem Content="AvailabilityOnly"/>
            <ComboBoxItem Content="LimitedDetails"/>
            <ComboBoxItem Content="None (remove access)"/>
          </ComboBox>
        </StackPanel>
      </Grid>
    </GroupBox>

    <!-- Options -->
    <GroupBox Header="  Options">
      <WrapPanel>
        <CheckBox x:Name="chkWhatIf"        Content="WhatIf (dry run, no changes)"/>
        <CheckBox x:Name="chkDisconnect"     Content="Disconnect when done"/>
        <CheckBox x:Name="chkSkipAlreadySet" Content="Skip if already set" IsChecked="True"/>
        <CheckBox x:Name="chkShowSkipped"    Content="Show skipped in log"/>
      </WrapPanel>
    </GroupBox>

    <!-- WhatIf warning banner — only visible when dry-run is active -->
    <Border x:Name="bannerWhatIf" Visibility="Collapsed"
            Background="#fef3c7" BorderBrush="#d97706" BorderThickness="1"
            CornerRadius="4" Margin="0,8,0,0" Padding="10,7">
      <TextBlock Text="DRY RUN MODE — WhatIf is ON. No permissions will be changed."
                 Foreground="#92400e" FontWeight="SemiBold" FontSize="12"
                 TextWrapping="Wrap"/>
    </Border>

    <!-- Buttons + Progress -->
    <Grid Margin="0,12,0,8">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="110"/>
        <ColumnDefinition Width="8"/>
        <ColumnDefinition Width="90"/>
      </Grid.ColumnDefinitions>
      <ProgressBar x:Name="progressBar" Height="10" VerticalAlignment="Center"
                   Foreground="#2563eb" Background="#e5e7eb" BorderThickness="0"/>
      <Button x:Name="btnRun"   Content="Run"   Grid.Column="1" Background="#16a34a"/>
      <Button x:Name="btnClear" Content="Clear" Grid.Column="3" Background="#6b7280"/>
    </Grid>

    <!-- Log output -->
    <Border Background="#1e1e2e" BorderBrush="#d1d5db" BorderThickness="1" CornerRadius="4">
      <RichTextBox x:Name="txtLog" Height="270" IsReadOnly="True"
                   Background="Transparent"
                   FontFamily="Consolas" FontSize="12"
                   VerticalScrollBarVisibility="Auto"
                   HorizontalScrollBarVisibility="Disabled"
                   Padding="8" BorderThickness="0"/>
    </Border>

    <!-- Status bar -->
    <TextBlock x:Name="lblStatus" Text="Not connected"
               Foreground="#6b7280" FontSize="12" Margin="0,7,0,0"/>

  </StackPanel>
</Window>
"@

# ── Build window from XAML ────────────────────────────────────────────────────
$reader = [System.Xml.XmlNodeReader]::new($xaml)
$window = [Windows.Markup.XamlReader]::Load($reader)

# ── Bind named controls to variables ─────────────────────────────────────────
$txtAdminUPN            = $window.FindName('txtAdminUPN')
$txtAdminUPNPlaceholder = $window.FindName('txtAdminUPNPlaceholder')
$lblUpnHint             = $window.FindName('lblUpnHint')
$btnConnect             = $window.FindName('btnConnect')
$cmbScope               = $window.FindName('cmbScope')
$txtDomains             = $window.FindName('txtDomains')
$gridSpecificUPNs           = $window.FindName('gridSpecificUPNs')
$txtSpecificUPNs            = $window.FindName('txtSpecificUPNs')
$txtSpecificUPNsPlaceholder = $window.FindName('txtSpecificUPNsPlaceholder')
$gridCSV                    = $window.FindName('gridCSV')
$txtCSVPath                 = $window.FindName('txtCSVPath')
$btnBrowse                  = $window.FindName('btnBrowse')
$cmbGrantTo                 = $window.FindName('cmbGrantTo')
$gridGrantToUser            = $window.FindName('gridGrantToUser')
$txtGrantToUser             = $window.FindName('txtGrantToUser')
$txtGrantToUserPlaceholder  = $window.FindName('txtGrantToUserPlaceholder')
$cmbAccess              = $window.FindName('cmbAccess')
$chkWhatIf              = $window.FindName('chkWhatIf')
$bannerWhatIf           = $window.FindName('bannerWhatIf')
$chkDisconnect          = $window.FindName('chkDisconnect')
$chkSkipAlready         = $window.FindName('chkSkipAlreadySet')
$chkShowSkipped         = $window.FindName('chkShowSkipped')
$btnRun                 = $window.FindName('btnRun')
$btnClear               = $window.FindName('btnClear')
$progressBar            = $window.FindName('progressBar')
$txtLog                 = $window.FindName('txtLog')
$txtLog.Document.Blocks.Clear()
$txtLog.Document.PagePadding = [System.Windows.Thickness]::new(0)
$lblStatus              = $window.FindName('lblStatus')

# Single shared-state object — PSCustomObject properties are references, so all closures
# and event handlers that hold this object see the same values without $script: scope issues
$script:appState = [PSCustomObject]@{ Connected = $false; WorkerRS = $null }

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Log {
    param($msg)
    $ts = (Get-Date).ToString('HH:mm:ss')
    $txtLog.Dispatcher.Invoke([action]{
        $color = switch -Regex ($msg) {
            '^\[OK\]'     { '#a6e3a1' }
            '^\[ERR\]'    { '#f38ba8' }
            '^\[SKIP\]'   { '#9ca3af' }
            '^\[WHATIF\]' { '#fcd34d' }
            'ERROR'       { '#f38ba8' }
            default       { '#cdd6f4' }
        }
        $para = [System.Windows.Documents.Paragraph]::new()
        $para.Margin = [System.Windows.Thickness]::new(0,0,0,1)
        $tr = [System.Windows.Documents.Run]::new("[$ts] ")
        $tr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4b5563')
        $mr = [System.Windows.Documents.Run]::new($msg)
        $mr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($color)
        $para.Inlines.Add($tr); $para.Inlines.Add($mr)
        $txtLog.Document.Blocks.Add($para)
        $txtLog.ScrollToEnd()
    })
}

function Set-Status {
    param($msg, $color)
    $lblStatus.Dispatcher.Invoke([action]{
        $lblStatus.Text       = $msg
        $lblStatus.Foreground = $color
    })
}

# ── Event handlers ────────────────────────────────────────────────────────────

# Validate UPN format as the user types and give live green/red feedback
$txtAdminUPN.Add_TextChanged({
    $upn = $txtAdminUPN.Text.Trim()
    $txtAdminUPNPlaceholder.Visibility = if ($upn.Length -eq 0) { 'Visible' } else { 'Collapsed' }

    if ($upn.Length -eq 0) {
        $txtAdminUPN.BorderBrush  = '#9ca3af'
        $lblUpnHint.Visibility    = 'Collapsed'
    } elseif ($upn -match '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        $txtAdminUPN.BorderBrush  = '#16a34a'
        $lblUpnHint.Text          = 'Looks good'
        $lblUpnHint.Foreground    = '#16a34a'
        $lblUpnHint.Visibility    = 'Visible'
    } else {
        $txtAdminUPN.BorderBrush  = '#dc2626'
        $lblUpnHint.Text          = 'Must be in format user@domain.com'
        $lblUpnHint.Foreground    = '#dc2626'
        $lblUpnHint.Visibility    = 'Visible'
    }
})

# Show/hide the UPN or CSV input based on the selected scope
$cmbScope.Add_SelectionChanged({
    $i = $cmbScope.SelectedIndex
    $txtDomains.Visibility       = if ($i -eq 2) { 'Visible' } else { 'Collapsed' }
    $gridSpecificUPNs.Visibility = if ($i -eq 3) { 'Visible' } else { 'Collapsed' }
    $gridCSV.Visibility          = if ($i -eq 4) { 'Visible' } else { 'Collapsed' }
    if ($i -eq 3) {
        $txtSpecificUPNsPlaceholder.Visibility = if ($txtSpecificUPNs.Text.Length -eq 0) { 'Visible' } else { 'Collapsed' }
    }
})

$txtSpecificUPNs.Add_TextChanged({
    $txtSpecificUPNsPlaceholder.Visibility = if ($txtSpecificUPNs.Text.Length -eq 0) { 'Visible' } else { 'Collapsed' }
})

# Show/hide the specific-user UPN field
$cmbGrantTo.Add_SelectionChanged({
    $gridGrantToUser.Visibility = if ($cmbGrantTo.SelectedIndex -eq 1) { 'Visible' } else { 'Collapsed' }
    if ($cmbGrantTo.SelectedIndex -eq 1) {
        $txtGrantToUserPlaceholder.Visibility = if ($txtGrantToUser.Text.Length -eq 0) { 'Visible' } else { 'Collapsed' }
    }
})

$txtGrantToUser.Add_TextChanged({
    $txtGrantToUserPlaceholder.Visibility = if ($txtGrantToUser.Text.Length -eq 0) { 'Visible' } else { 'Collapsed' }
})

$chkWhatIf.Add_Checked({   $bannerWhatIf.Visibility = 'Visible' })
$chkWhatIf.Add_Unchecked({ $bannerWhatIf.Visibility = 'Collapsed' })

# Open a file picker and put the chosen path in the read-only text box
$btnBrowse.Add_Click({
    $dlg = [Microsoft.Win32.OpenFileDialog]@{ Filter = 'CSV files|*.csv'; Title = 'Select CSV' }
    if ($dlg.ShowDialog()) { $txtCSVPath.Text = $dlg.FileName }
})

$btnClear.Add_Click({ $txtLog.Document.Blocks.Clear() })

$btnConnect.Add_Click({
    $upn = $txtAdminUPN.Text.Trim()
    $btnConnect.IsEnabled = $false
    Set-Status 'Connecting...' '#f9e2af'
    Write-Log 'Connecting to Exchange Online...'

    # Tear down any previous runspace so the user can reconnect cleanly
    if ($script:appState.WorkerRS) { try { $script:appState.WorkerRS.Dispose() } catch {} }
    $script:appState.WorkerRS = [runspacefactory]::CreateRunspace()
    $script:appState.WorkerRS.ApartmentState = 'STA'
    $script:appState.WorkerRS.ThreadOptions  = 'ReuseThread'
    $script:appState.WorkerRS.Open()

    # Connect Exchange Online inside the persistent runspace so all subsequent runs reuse the session
    $connectPS = [powershell]::Create()
    $connectPS.Runspace = $script:appState.WorkerRS
    # ExchangeOnlineManagement 3.7+ signs in through WAM by default, which needs a parent window
    # handle. A background runspace has none, so the login prompt never shows and Connect hangs.
    # -DisableWAM falls back to the browser sign-in.
    $connectScript = {
        param($upn)
        Import-Module ExchangeOnlineManagement -ErrorAction Stop
        $params = @{ ShowProgress = $false; ErrorAction = 'Stop' }
        if ($upn) { $params.UserPrincipalName = $upn }
        if ((Get-Command Connect-ExchangeOnline).Parameters.ContainsKey('DisableWAM')) { $params.DisableWAM = $true }
        Connect-ExchangeOnline @params
    }
    $connectPS.AddScript($connectScript.ToString()).AddArgument($upn) | Out-Null
    $connectPS.BeginInvoke() | Out-Null

    # Embed controls directly — GetNewClosure captures variables but not script-scope functions
    $connectTimerState = [PSCustomObject]@{
        PS         = $connectPS
        Timer      = $null
        BtnConnect = $btnConnect
        LblStatus  = $lblStatus
        TxtLog     = $txtLog
        Upn        = $upn
        AppState   = $script:appState
        Ticks      = 0
    }
    $connectTimer = [System.Windows.Threading.DispatcherTimer]::new()
    $connectTimer.Interval = [TimeSpan]::FromMilliseconds(500)
    $connectTimerState.Timer = $connectTimer
    $connectTimer.Add_Tick({
        $s = $connectTimerState
        $s.Ticks++
        if ($s.Ticks -eq 120) {
            # 60 s without a result — usually the sign-in window is hidden behind this one
            $para = [System.Windows.Documents.Paragraph]::new(); $para.Margin = [System.Windows.Thickness]::new(0,0,0,1)
            $mr = [System.Windows.Documents.Run]::new("Still waiting for sign-in. Check for a browser/login window behind this one."); $mr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#fcd34d')
            $para.Inlines.Add($mr); $s.TxtLog.Document.Blocks.Add($para); $s.TxtLog.ScrollToEnd()
        }
        if ($s.PS.InvocationStateInfo.State -in 'Completed', 'Failed', 'Stopped') {
            $s.Timer.Stop()
            $s.BtnConnect.IsEnabled = $true
            $ts = (Get-Date).ToString('HH:mm:ss')
            if ($s.PS.HadErrors -or $s.PS.InvocationStateInfo.State -ne 'Completed') {
                $s.AppState.Connected   = $false
                $s.LblStatus.Text       = 'Connection failed'
                $s.LblStatus.Foreground = '#f38ba8'
                # A terminating error lands in InvocationStateInfo.Reason, not in the Error stream
                $err = if ($s.PS.InvocationStateInfo.Reason) { $s.PS.InvocationStateInfo.Reason.Message }
                       elseif ($s.PS.Streams.Error.Count) { $s.PS.Streams.Error[0].Exception.Message }
                       else { 'Connection was stopped.' }
                $para = [System.Windows.Documents.Paragraph]::new(); $para.Margin = [System.Windows.Thickness]::new(0,0,0,1)
                $tr = [System.Windows.Documents.Run]::new("[$ts] "); $tr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4b5563')
                $mr = [System.Windows.Documents.Run]::new("ERROR: $err"); $mr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#f38ba8')
                $para.Inlines.Add($tr); $para.Inlines.Add($mr); $s.TxtLog.Document.Blocks.Add($para); $s.TxtLog.ScrollToEnd()
            } else {
                $s.AppState.Connected   = $true
                $s.LblStatus.Text       = "Connected as $($s.Upn)"
                $s.LblStatus.Foreground = '#a6e3a1'
                $para = [System.Windows.Documents.Paragraph]::new(); $para.Margin = [System.Windows.Thickness]::new(0,0,0,1)
                $tr = [System.Windows.Documents.Run]::new("[$ts] "); $tr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4b5563')
                $mr = [System.Windows.Documents.Run]::new("Connected to Exchange Online."); $mr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#a6e3a1')
                $para.Inlines.Add($tr); $para.Inlines.Add($mr); $s.TxtLog.Document.Blocks.Add($para); $s.TxtLog.ScrollToEnd()
            }
            $s.PS.Dispose()
        }
    }.GetNewClosure())
    $connectTimer.Start()
})

# ── Background worker ─────────────────────────────────────────────────────────
# Runs in a separate STA runspace so the UI stays responsive during long operations.
# Single-quoted here-string prevents the outer parser from interpreting $variables
# inside the block — they are only evaluated when the runspace executes the script.
$workerCode = @'
param(
    $scopeIndex, $domains, $specificUPNs, $csvPath,
    $grantTo, $accessRight,
    $whatIf, $skipIfSet, $showSkipped,
    $dispatcher, $progressBar, $txtLog, $lblStatus
)

# No Connect-ExchangeOnline here — the runspace was already connected by the Connect button
# and is reused for every run, so no re-authentication is needed between runs.

function Log($msg) {
    $ts = (Get-Date).ToString('HH:mm:ss')
    $dispatcher.Invoke([action]{
        $color = switch -Regex ($msg) {
            '^\[OK\]'     { '#a6e3a1' }
            '^\[ERR\]'    { '#f38ba8' }
            '^\[SKIP\]'   { '#9ca3af' }
            '^\[WHATIF\]' { '#fcd34d' }
            'ERROR'       { '#f38ba8' }
            default       { '#cdd6f4' }
        }
        $para = [System.Windows.Documents.Paragraph]::new()
        $para.Margin = [System.Windows.Thickness]::new(0,0,0,1)
        $tr = [System.Windows.Documents.Run]::new("[$ts] ")
        $tr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4b5563')
        $mr = [System.Windows.Documents.Run]::new($msg)
        $mr.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($color)
        $para.Inlines.Add($tr); $para.Inlines.Add($mr)
        $txtLog.Document.Blocks.Add($para)
        $txtLog.ScrollToEnd()
    })
}

function SetStatus($msg, $col) {
    $dispatcher.Invoke([action]{ $lblStatus.Text = $msg; $lblStatus.Foreground = $col })
}

# Resolve the mailbox list based on the chosen scope
$mailboxes = switch ($scopeIndex) {
    0 { Get-Mailbox -RecipientTypeDetails UserMailbox                    -ResultSize Unlimited }
    1 { Get-Mailbox -RecipientTypeDetails UserMailbox,SharedMailbox      -ResultSize Unlimited }
    2 {
        # Fetch all user mailboxes then filter by the supplied domain list
        $domainList = $domains -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
        Get-Mailbox -RecipientTypeDetails UserMailbox,SharedMailbox -ResultSize Unlimited |
            Where-Object { $domainList -contains ($_.PrimarySmtpAddress -split '@')[1].ToLower() }
    }
    3 { $specificUPNs -split ',' | ForEach-Object { Get-Mailbox $_.Trim() -ErrorAction SilentlyContinue } }
    4 {
        $csv    = Import-Csv $csvPath
        # Accept column headers named UPN, Mail, or SMTP (case-insensitive)
        $colName = ($csv[0].PSObject.Properties.Name | Where-Object { $_ -match '^(upn|mail|smtp)$' })[0]
        if (-not $colName) { Log 'ERROR: CSV must have a column named UPN, Mail, or SMTP.'; return }
        $csv | ForEach-Object { Get-Mailbox $_.$colName -ErrorAction SilentlyContinue }
    }
}

$total = @($mailboxes).Count
Log "Processing $total mailboxes | Access: $accessRight | GrantTo: $grantTo"

$ok = 0; $skip = 0; $fail = 0; $i = 0

# Calendar folder name keyed by the two-char language code from each mailbox's Languages property.
# Exchange Online uses the mailbox locale for display names — same folder, different name per language.
# Add entries here for any language not already listed.
$calNameByLang = @{
    'da' = 'Kalender'    # Danish
    'sv' = 'Kalender'    # Swedish
    'nb' = 'Kalender'    # Norwegian Bokmål
    'nn' = 'Kalender'    # Norwegian Nynorsk
    'no' = 'Kalender'    # Norwegian (generic)
    'de' = 'Kalender'    # German
    'en' = 'Calendar'    # English
    'fr' = 'Calendrier'  # French
    'nl' = 'Agenda'      # Dutch
    'es' = 'Calendario'  # Spanish
    'it' = 'Calendario'  # Italian
    'pt' = 'Calendário'  # Portuguese
    'fi' = 'Kalenteri'   # Finnish
    'pl' = 'Kalendarz'   # Polish
    'cs' = 'Kalendář'    # Czech
    'hu' = 'Naptár'      # Hungarian
    'tr' = 'Takvim'      # Turkish
    'ru' = 'Календарь'   # Russian
}
$calFolderCache = @{}  # fallback cache for languages not in the table above (one stats call per domain)

foreach ($mbx in $mailboxes) {
    $i++
    $pct = [int](($i / $total) * 100)
    $dispatcher.Invoke([action]{ $progressBar.Value = $pct })

    $smtp   = $mbx.PrimarySmtpAddress
    $domain = ($smtp -split '@')[1]
    $label  = "$($mbx.DisplayName) ($smtp)"

    try {
        # Derive the two-char language code from the mailbox's first language preference
        $langCode  = if ($mbx.Languages.Count -gt 0) { "$($mbx.Languages[0])" -replace '-.*','' } else { '' }
        $calFolder = if ($calNameByLang.ContainsKey($langCode)) {
            $calNameByLang[$langCode]
        } else {
            # Language not in table — resolve once per domain via stats and cache the result
            if (-not $calFolderCache.ContainsKey($domain)) {
                $resolved = (Get-MailboxFolderStatistics -Identity $smtp -FolderScope Calendar |
                             Where-Object { $_.FolderType -eq 'Calendar' } |
                             Select-Object -First 1).Name
                $calFolderCache[$domain] = if ($resolved) { $resolved } else { 'Calendar' }
                Log "Resolved calendar folder for $domain`: $($calFolderCache[$domain])"
            }
            $calFolderCache[$domain]
        }
        $cal = "${smtp}:\${calFolder}"

        if ($skipIfSet) {
            # Only call Get-MailboxFolderPermission when we actually need to check
            $existing = Get-MailboxFolderPermission -Identity $cal -User $grantTo -ErrorAction SilentlyContinue
            if ($existing.AccessRights -contains $accessRight) {
                if ($showSkipped) { Log "[SKIP]  $label" }
                $skip++
                continue
            }
        }

        if (-not $whatIf) {
            if ($accessRight -eq 'None') {
                # SilentlyContinue so we don't error when there is no row to remove
                Remove-MailboxFolderPermission -Identity $cal -User $grantTo -Confirm:$false -ErrorAction SilentlyContinue
            } else {
                # Optimistic Set — falls back to Add when no permission row exists yet,
                # eliminating a pre-check round-trip on every mailbox
                try {
                    Set-MailboxFolderPermission -Identity $cal -User $grantTo -AccessRights $accessRight -ErrorAction Stop | Out-Null
                } catch {
                    Add-MailboxFolderPermission -Identity $cal -User $grantTo -AccessRights $accessRight -ErrorAction Stop | Out-Null
                }
            }
        }

        $tag = if ($whatIf) { 'WHATIF' } else { 'OK' }
        Log "[$tag]  $label"
        $ok++
    } catch {
        Log "[ERR]  $label - $($_.Exception.Message)"
        $fail++
    }
}

$dispatcher.Invoke([action]{ $progressBar.Value = 0 })
Log "Done - OK: $ok  Skipped: $skip  Failed: $fail"
SetStatus "Done - OK: $ok | Skipped: $skip | Failed: $fail" '#a6e3a1'
'@

# ── Run button ────────────────────────────────────────────────────────────────
$btnRun.Add_Click({
    if (-not $script:appState.Connected) { Write-Log 'Not connected. Click Connect first.'; return }

    # Strip display-label suffixes to get the raw Exchange access-right value
    $accessRight = switch ($cmbAccess.SelectedItem.Content) {
        'None (remove access)'  { 'None' }
        'Reviewer (read-only)'  { 'Reviewer' }
        'Owner (full control)'  { 'Owner' }
        default                 { $cmbAccess.SelectedItem.Content }
    }

    $grantTo = if ($cmbGrantTo.SelectedIndex -eq 1) { $txtGrantToUser.Text.Trim() } else { 'Default' }

    if ($cmbGrantTo.SelectedIndex -eq 1 -and -not $grantTo) {
        Write-Log 'ERROR: Enter a UPN in the Specific user field.'
        return
    }

    $btnRun.IsEnabled = $false
    Set-Status 'Running...' '#f9e2af'

    # Reuse the persistent runspace created by Connect — no new login needed
    $ps = [powershell]::Create()
    $ps.Runspace = $script:appState.WorkerRS
    $ps.AddScript($workerCode).
        AddArgument($cmbScope.SelectedIndex).
        AddArgument($txtDomains.Text).
        AddArgument($txtSpecificUPNs.Text).
        AddArgument($txtCSVPath.Text).
        AddArgument($grantTo).
        AddArgument($accessRight).
        AddArgument([bool]$chkWhatIf.IsChecked).
        AddArgument([bool]$chkSkipAlready.IsChecked).
        AddArgument([bool]$chkShowSkipped.IsChecked).
        AddArgument($window.Dispatcher).
        AddArgument($progressBar).
        AddArgument($txtLog).
        AddArgument($lblStatus) | Out-Null

    $ps.BeginInvoke() | Out-Null

    # DispatcherTimer polls on the UI thread — unlike Register-ObjectEvent which fires on a
    # thread-pool thread where accessing WPF controls throws InvalidOperationException silently
    $timer = [System.Windows.Threading.DispatcherTimer]::new()
    $timer.Interval = [TimeSpan]::FromMilliseconds(500)
    $timerState = [PSCustomObject]@{
        PS         = $ps
        Timer      = $timer
        BtnRun     = $btnRun
        Disconnect = $chkDisconnect
        AppState   = $script:appState
    }
    $timer.Add_Tick({
        $s = $timerState
        if ($s.PS.InvocationStateInfo.State -in 'Completed', 'Failed', 'Stopped') {
            $s.Timer.Stop()
            $s.BtnRun.IsEnabled = $true
            if ($s.Disconnect.IsChecked) {
                # Run disconnect in the persistent runspace, then tear it down
                $dcPS = [powershell]::Create()
                $dcPS.Runspace = $s.AppState.WorkerRS
                $dcPS.AddScript('Disconnect-ExchangeOnline -Confirm:$false') | Out-Null
                $dcPS.Invoke()
                $dcPS.Dispose()
                $s.AppState.WorkerRS.Dispose()
                $s.AppState.WorkerRS   = $null
                $s.AppState.Connected  = $false
            }
            $s.PS.Dispose()  # dispose the run's PS instance; WorkerRS stays open for next run
        }
    }.GetNewClosure())
    $timer.Start()
})

# ── Launch window ─────────────────────────────────────────────────────────────
$window.ShowDialog() | Out-Null
