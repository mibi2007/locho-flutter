import 'package:locho_notes/session.dart';
import 'package:locho_notes/transport.dart';

Credentials createCredentials() => SecureCredentials();
SessionDependencies createDependencies() => SessionDependencies.native();
