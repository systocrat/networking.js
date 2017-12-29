# Networking.js
Browser-side Type/Length/Value parsing for WebSocket applications.
Networking.js has support for parsing arbitrary structures as well, but this functionality is very untested and undocumented so I would recommend against using it.

## Dependencies
Networking.js depends on [ByteBuffer.js](https://github.com/dcodeIO/bytebuffer.js/wiki/API) to function- ByteBuffer.js must be loaded before Networking.js at all times

## Packet Structure

A TLV packet built by or expected by networking.js is structured as follows:
```
|     Field     | Size (octets) |       Type       |            Description             |
| ------------- | ------------- | ---------------- | ---------------------------------- |
|  Packet Type  |       4       | Unsigned Integer |        The packet identifier       |
| Packet Length |       4       | Unsigned Integer | The length of the packet in octets |
| Packet Fields | $PacketLength |     Variable     |   The binary-encoded packet data   |
```

## Potential Field Types

Before we get into usage, the default field types are as follows:
```
|  Field  |                                  Size (octets)                                 |    Parser Arguments    | Expected JS argument type |
| ------- | ------------------------------------------------------------------------------ | ---------------------- | ------------------------- |
| istring | 4 (unsigned int representing string length) + len(UTF-encoded string argument) |          None          |           String          |
|  array  |       sizeof($length_type) + (sizeof($data_type) * len(argument_array));       | Length Type, Data Type |           Varies          |
|   bool  |                                        1                                       |          None          |          Boolean          |
|   uint  |                                        4                                       |          None          |          Integer          |
|  ushort |                                        2                                       |          None          |          Integer          |
|   byte  |                                        1                                       |          None          |          Integer          |
|  double |                                        8                                       |          None          |           Double          |
|  float  |                                        4                                       |          None          |           Double          |
|   int   |                                        4                                       |          None          |          Integer          |
|  short  |                                        2                                       |          None          |          Integer          |
|  varint |                             Varies (look up VarInt)                            |          None          |          Integer          |
```

## Usage
First, define your packet tables:
```
const Packet = window.Networking.Packet;
const ProtocolHandler = window.Networking.ProtocolHandler;

const write_packets = [
    new Packet("Echo", 0x1, [
        ["text", "istring"]
    ])
];

const read_packets = [
    new Packet("EchoResult", 0x1, [
        ["text", "istring"],
    ])
];
```

Next, you define your protocol handler and open a websocket:
```
const protocol = new ProtocolHandler(read_packets, write_packets);
const ws = new WebSocket('ws://example.com/');
ws.binaryType = "arraybuffer";  // set the binary type to arraybuffer (for compat with bytebuffer.js)
```

And then you define your message handler:
```
ws.addEventListener('message', function (event) {
    protocol.addData(event.data);

    for (;;) {
        // read until we can't read anymore
        try {
            var packet = protocol.readPacket();
            
            if (packet.packetName === "EchoResult") {
                console.log(packet.text); // fields are just available, right on the packet data object :)
            }
        } catch (err) {
            break;
        }
    }
});
```

Now, to send a serialized packet it's very simple:
```
ws.send(protocol.buildPacket("Echo", ["Echo data"]));
```
The array passed to protocol.buildPacket is an ordered array of the objects to pass to the serialization functions defined by the packet descriptor associated with the name Echo (defined above).

## Internals Info / Caveats
As you can see from the example above, a Packet is a descriptor for the name of a packet, the packet ID, and the fields for a packet.

Fields are defined as an array of arrays, where the inner array has a structure of `[field name, field type, *parser_args]`.
The parser_args field is a bit special- You can use it to pass arguments to say, the `array` parser as follows:
```
["playerIDs", "array", "uint", "uint"]
```
Where the first `uint` is the type used as a length prefix for an array of encoded `uint`s (which in this example is a list of player IDs for a fictional game).

Now, you don't necessarily have to pass just parser names as arguments! But when you pass a string containing the name of a parser type (including a custom-defined type), Networking.js will look-up internally the associated parser or writer function and pass that to your parser/writer function for the type you are attempting to deserialize or serialize.


