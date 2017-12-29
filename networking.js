(function () {
    if (window.Networking) {
        console.error("Networking namespace already defined");
        return;
    }

    const Networking = {};

    ByteBuffer = window.dcodeIO.ByteBuffer;

    ByteBuffer.prototype.readArray = function (len_func, type_func) {
        var a = [];
        var len = this[len_func]();

        for (var x = 0; x < len; x++) {
            a.push(this[type_func]());
        }

        return a;
    };

    ByteBuffer.prototype.writeArray = function (data, len_func, type_func) {
        this[len_func](a.length);

        data.forEach(function (val, i, a) {
            this[type_func](val);

        }, this);
    };


    function Packet(name, packetID, args) {
        this.name = name;
        this.packetID = packetID;
        this.args = args;
    }

    /*
        var packet = new Packet("ExamplePacket", 0x01, [
            ["example_field", "uint"],
            ["example_field_2", "array", "uint", "uint"]
        ]);

        example_field_2 is an Array[uint32] whose length is prefixed by a uint
     */

    Packet.prototype.constructor = Packet;

    function IOFunction(name, type_name, func) {
        this.name = name;
        this.type_name = type_name;
        this.func = func;
    }

    IOFunction.prototype.constructor = IOFunction;

    const base_read_functions = {
        'istring': 'readIString',
        'array': 'readArray',
        'bool': 'readUint8',
        'uint': 'readUint32',
        'ushort': 'readUint16',
        'byte': 'readUint8',
        'double': 'readFloat64',
        'float': 'readFloat32',
        'int': 'readInt32',
        'short': 'readInt16',
        'varint': 'readVarint32'
    };

    const base_write_functions = {
        'istring': 'writeIString',
        'array': 'writeArray',
        'bool': 'writeUint8',
        'uint': 'writeUint32',
        'ushort': 'writeUint16',
        'byte': 'writeUint8',
        'double': 'writeFloat64',
        'float': 'writeFloat32',
        'int': 'writeInt32',
        'short': 'writeInt16',
        'varint': 'writeVarint32'
    };

    function ProtocolHandler(read_packets, write_packets, extra_read_functions, extra_write_functions) {
        /*
        ProtocolHandler is a class meant for reading an writing specifically structured binary data from a WebSocket.

        The format is a simple Type/Length/Value system

        PacketID: uint32 (4 octet unsigned integer)
        PacketLength: uint64 (8 octet unsigned integer) == len(PacketData)
        PacketData: Binary blob whose length == PacketLength


        (read|write)_packets are both Array[Packet].
        Each packet is added this.(read|write)_packets, which are associative arrays of (packetID||packetname) to Packet
        object.

        PacketID needs to be a string when performing lookups because Javascript is bad.

        extra_(read|write)_functions are both Array[IOFunction].
        An IOFunction defines the name of the read function to bind to this.(reader|writer) for later usage (.name),
        the type name to use in packet definitions (.type_name) and the function to perform the (read|write) when
        ProtocolHandler.readPacket/buildPacket are called.

        */
        this.read_packets = {};
        this.write_packets = {};

        this.extra_read_functions = extra_read_functions || [];
        this.extra_write_functions = extra_write_functions || [];

        // JS is the apex of language design
        this.read_functions = Object.assign({}, base_read_functions);
        this.write_functions = Object.assign({}, base_write_functions);

        for (var i = 0; i < read_packets.length; i++) {
            var pkt = read_packets[i];

            this.read_packets[pkt.name] = pkt;
            this.read_packets[pkt.packetID.toString()] = pkt;
        }


        for (i = 0; i < write_packets.length; i++) {
            pkt = write_packets[i];
            this.write_packets[pkt.name] = pkt;
            this.write_packets[pkt.packetID.toString()] = pkt;
        }

        this.reader = new ByteBuffer();
        this.writer = new ByteBuffer();

        // use prototyping magic to do something that in any sensible language we wouldn't have to do

        for (i = 0; i < this.extra_read_functions; i++) {
            var prop = this.extra_read_functions[i];

            this.reader[prop.name] = prop.func.bind(this.reader);
            this.read_functions[prop.type_name] = prop.name;
        }

        for (i = 0; i < this.extra_write_functions; i++) {
            prop = this.extra_write_functions[i];

            this.writer[prop.name] = prop.func.bind(this.writer);
            this.write_functions[prop.type_name] = prop.name;
        }
    }

    ProtocolHandler.prototype.addData = function (data) {
        data = data || "";
        var offset = this.reader.offset;
        this.reader.append(data, "binary");
        this.reader.offset = offset;
    };

    ProtocolHandler.prototype.readPacket = function () {
        /* Reads the next packet from this.reader */

        var offset = this.reader.offset;
        var packet = {};

        try {
            var packetID = this.reader.readUInt32();
            var packetLength = this.reader.readUInt32();

            packet.packetID = packetID;
            packet.packetLength = packetLength;

            packetID = packetID.toString();

            if (this.read_packets.hasOwnProperty(packetID)) {
                var pkt = this.read_packets[packetID];

                for (var i = 0; i < pkt.args.length; i++) {
                    var field_args = pkt.args[i];
                    var field_name = field_args[0];
                    // get the function's name by the packets type, then the function itself through this.reader[functionName]
                    var parser = this.reader[this.read_functions[field_args[1]]];

                    var reader_params = null;

                    if (field_args.length > 2) {
                        // get any extra arguments that need to be passed to the parser function

                        reader_params = field_args.slice(2);

                        for (var extra = 0; extra < reader_params.length; extra++) {
                            var extraProperty = reader_params[extra];

                            if (this.read_functions.hasOwnProperty(extraProperty)) {
                                reader_params[extra] = this.reader[this.read_functions[extraProperty]];
                            }
                        }
                    }

                   //  reader_params.unshift(this.reader);
                    // since to our knowledge function is bound already, we assume that .call() will work just fine
                    packet[field_name] = parser.apply(this.reader, reader_params || []);
                }

            } else {
                // or skip it
                this.read_packets.skip(packetLength);
            }

            return packet;
        } catch (err) {
            this.reader.offset = offset;
            throw new RangeError();
        }
    };

    ProtocolHandler.prototype.buildPacket = function (name_or_id, packet_args) {
        var packet = this.write_packets[name_or_id.toString()];

        if (packet_args.length !== packet.args.length)
            throw new RangeError();

        this.writer.writeUInt32(packet.packetID);
        this.writer.writeUInt32(0);

        for (var i = 0; i < packet.args.length; i++) {
            var field_args = packet.args[i];
            // var field_name = field_args[0];

            var writer = this.writer[this.write_functions[field_args[1]]];

            var writer_params = null;

            if (field_args.length > 2) {
                writer_params = field_args.slice(2);

                for (var extra = 0; extra < writer_params.length; extra++) {
                    var ep = writer_params[extra];

                    if (this.write_functions.hasOwnProperty(ep)) {
                        writer_params[extra] = this.writer[this.write_functions[ep]];
                    }
                }

            }

            writer_params = writer_params || [];

            writer_params.unshift(packet_args[i]);

            writer.apply(this.writer, writer_params);
        }

        this.writer.flip();
        // writes buffer.limit - 8 at offset 4 (octets)
        // because after .flip(), this.writer.limit = the previous offset (the end of the packet)
        this.writer.writeUint32(this.writer.limit - 8, 4);

        var result = this.writer.toArrayBuffer();

        this.writer.buffer = new ArrayBuffer(1);
        this.writer.clear();

        return result;
    };

    ProtocolHandler.prototype.constructor = ProtocolHandler;

    Networking.ProtocolHandler = ProtocolHandler;
    Networking.Packet = Packet;
    Networking.IOFunction = IOFunction;
    window.Networking = Networking;

}());
