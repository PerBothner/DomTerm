Name:           domterm
Version:        0.70
Release:        1%{?dist}
Summary:        A terminal emulator based on web technologies

License:        BSD
URL:            http://domterm.org/  
Source0:        domterm-master.tar.gz
#Source0:        https://github.com/PerBothner/DomTerm/archive/master.tar.gz
#Source0:        https://github.com/PerBothner/DomTerm/archive/%{commit0}.tar.gz

BuildRequires:  libwebsockets-devel%{?_isa} json-c-devel
Requires:       json-c

%global commit0 574e37bbda5b64ea93327cef45e44f744d8b2132
%global gittag0 master
%global shortcommit0 %(c=%{commit0}; echo ${c:0:7})

%description
A terminal emulator based on web technologies

%prep
echo in prep section1
%autosetup -n domterm-master
echo in prep section2

%build
autoreconf
%configure --disable-pty
%make_build

%install
rm -rf $RPM_BUILD_ROOT
make DESTDIR=$RPM_BUILD_ROOT install-ldomterm install-data

%files
%{_bindir}/domterm
%{_bindir}/ldomterm
%{_datadir}/domterm/application.ini
%{_datadir}/domterm/chrome.manifest
%{_datadir}/domterm/defaults/preferences/prefs.js
%{_datadir}/domterm/domterm.jar


%changelog
* Thu Feb  9 2017 Per Bothner <per@bothner.com>
- 
