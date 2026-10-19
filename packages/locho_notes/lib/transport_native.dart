import 'package:http/http.dart' as http;
import 'package:locho_flutter/locho_flutter.dart' as sdk;
import 'transport.dart';

SessionDependencies createDependencies() => SessionDependencies(
  parse: (text) async => _Ticket(await sdk.LochoTicket.parse(text)),
  create: () async => _Client(await sdk.LochoClient.create()),
  httpClient: http.Client.new,
  eventClient: http.Client.new,
);

class _Ticket implements Pairing {
  final sdk.LochoTicket ticket;
  _Ticket(this.ticket);
  @override
  String get hostId => ticket.hostId;
  @override
  String get service => ticket.service;
  @override
  String get serviceType => ticket.serviceType;
  @override
  Future<String> export() => ticket.export();
}

class _Client implements TunnelClient {
  final sdk.LochoClient client;
  _Client(this.client);
  @override
  Future<Attachment> attach(Pairing ticket) async =>
      _Attachment(await client.attach(ticket: (ticket as _Ticket).ticket));
  @override
  Future<void> close() => client.close();
}

class _Attachment implements Attachment {
  final sdk.LochoAttachment attachment;
  _Attachment(this.attachment);
  @override
  Uri get httpBaseUri => attachment.httpBaseUri;
  @override
  Stream<LochoState> get states => attachment.statuses.map(
    (value) => LochoState.values.byName(value.state.name),
  );
}
