; Per-user Windows installer for sea-mail: no admin rights, no Node.js, no terminal needed.
;
; Build the layout first, then compile (both on Windows; .github/workflows/windows-installer.yml does this):
;   node scripts\package-windows.mjs
;   iscc /DAppVersion=0.1.0 installer\sea-mail.iss
; Output: build\windows\sea-mail-setup-<version>.exe

#ifndef AppVersion
  #error Pass the version to compile: iscc /DAppVersion=x.y.z installer\sea-mail.iss
#endif
#ifndef LayoutDir
  #define LayoutDir "..\build\windows\sea-mail"
#endif
#ifndef OutputDir
  #define OutputDir "..\build\windows"
#endif

[Setup]
; Keep AppId fixed: it is how a newer installer finds and upgrades an existing install.
AppId={{DD203667-374C-4A5D-B5A4-724E39535F80}
AppName=sea-mail
AppVersion={#AppVersion}
AppVerName=sea-mail {#AppVersion}
AppPublisher=sea-mail
AppPublisherURL=https://github.com/thaitv21/seamail
AppSupportURL=https://github.com/thaitv21/seamail
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\sea-mail
DisableDirPage=yes
DefaultGroupName=sea-mail
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; Tells Explorer to reload the user PATH that [Code] edits, at the end of install and uninstall.
ChangesEnvironment=yes
OutputDir={#OutputDir}
OutputBaseFilename=sea-mail-setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=sea-mail
SetupLogging=yes

[InstallDelete]
; An upgrade replaces the runtime and the app wholesale, so no file of an older version lingers.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\node"

[Files]
Source: "{#LayoutDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Console commands below run cmd /c ""<app>\bin\sea-mail.cmd" <args> & echo. & pause" (in Inno, "" is one
; quote), so the window stays open until the user has read the output.
[Icons]
Name: "{group}\Set up sea-mail"; Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" setup & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Comment: "Connect sea-mail to your mailbox and download your mail"
Name: "{group}\Sync mail now"; Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" sync & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Comment: "Fetch new mail into sea-mail's local index"
Name: "{group}\Uninstall sea-mail"; Filename: "{uninstallexe}"

; Finish-page checkboxes, run in this order. Each "Connect" box is ticked when that app looks installed.
; Setup comes last and does not hold the wizard open (nowait).
[Run]
Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" connect --client claude & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Description: "Connect Claude Desktop to sea-mail"; Flags: postinstall skipifsilent; Check: ClaudeInstalled
Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" connect --client claude & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Description: "Connect Claude Desktop to sea-mail"; Flags: postinstall skipifsilent unchecked; Check: not ClaudeInstalled
Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" connect --client codex & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Description: "Connect Codex to sea-mail"; Flags: postinstall skipifsilent; Check: CodexInstalled
Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" connect --client codex & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Description: "Connect Codex to sea-mail"; Flags: postinstall skipifsilent unchecked; Check: not CodexInstalled
Filename: "{cmd}"; Parameters: "/c """"{app}\bin\sea-mail.cmd"" setup & echo. & pause"""; WorkingDir: "{%USERPROFILE}"; Description: "Set up sea-mail now (connect it to your mailbox)"; Flags: postinstall skipifsilent nowait

[Code]
const
  EnvironmentKey = 'Environment';

function BinDir: String;
begin
  Result := ExpandConstant('{app}\bin');
end;

{ Where sea-mail keeps its settings and mail index: the same rule as homeDir() in src/core/config.ts. }
function DataDir: String;
begin
  Result := GetEnv('SEA_MAIL_HOME');
  if Result = '' then
    Result := ExpandConstant('{%USERPROFILE}\.sea-mail');
end;

function ClaudeInstalled: Boolean;
var
  FindRec: TFindRec;
begin
  Result := DirExists(ExpandConstant('{userappdata}\Claude'));
  { The Microsoft Store build keeps its data under a package folder instead. }
  if not Result and FindFirst(ExpandConstant('{localappdata}\Packages\Claude_*'), FindRec) then
  begin
    Result := True;
    FindClose(FindRec);
  end;
end;

function CodexInstalled: Boolean;
begin
  Result := (GetEnv('CODEX_HOME') <> '') or DirExists(ExpandConstant('{%USERPROFILE}\.codex'));
end;

{ Path without its entries equal to Dir (ignoring case and a trailing backslash); Found says whether there were any. }
function PathWithout(Path, Dir: String; var Found: Boolean): String;
var
  Rest, Entry: String;
  Sep: Integer;
begin
  Result := '';
  Found := False;
  Rest := Path + ';';
  while Rest <> '' do
  begin
    Sep := Pos(';', Rest);
    Entry := Copy(Rest, 1, Sep - 1);
    Delete(Rest, 1, Sep);
    if CompareText(RemoveBackslash(Entry), RemoveBackslash(Dir)) = 0 then
      Found := True
    else if Entry <> '' then
    begin
      if Result <> '' then
        Result := Result + ';';
      Result := Result + Entry;
    end;
  end;
end;

procedure AddToUserPath(Dir: String);
var
  Path: String;
  Found: Boolean;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Path) then
    Path := '';
  PathWithout(Path, Dir, Found);
  if Found then
    exit;
  if Path = '' then
    Path := Dir
  else if Copy(Path, Length(Path), 1) = ';' then
    Path := Path + Dir
  else
    Path := Path + ';' + Dir;
  { An expandable string keeps entries such as %USERPROFILE%\... working. }
  RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Path);
end;

procedure RemoveFromUserPath(Dir: String);
var
  Path, Kept: String;
  Found: Boolean;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Path) then
    exit;
  Kept := PathWithout(Path, Dir, Found);
  if Found then
    RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Kept);
end;

{ Removes sea-mail from a client's config, but only an entry that runs this installation. }
procedure Disconnect(Client: String);
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{app}\node\node.exe'),
    '"' + ExpandConstant('{app}\app\dist\cli\index.js') + '" connect --client ' + Client + ' --remove',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    AddToUserPath(BinDir);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    { Before the files go: these run the bundled node. }
    Disconnect('claude');
    Disconnect('codex');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    RemoveFromUserPath(BinDir);
    if DirExists(DataDir) and not UninstallSilent then
      if MsgBox('Also delete sea-mail''s settings and its local copy of your mail?' + #13#10#13#10 +
          DataDir + #13#10#13#10 +
          'Choose No to keep them for a later reinstall. Your mailbox on the server is not affected either way.',
          mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
