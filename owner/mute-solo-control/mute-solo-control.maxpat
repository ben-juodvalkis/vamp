{
	"patcher" : 	{
		"fileversion" : 1,
		"appversion" : 		{
			"major" : 9,
			"minor" : 1,
			"revision" : 4,
			"architecture" : "x64",
			"modernui" : 1
		},
		"classnamespace" : "box",
		"rect" : [ 100.0, 100.0, 600.0, 400.0 ],
		"openrect" : [ 0.0, 0.0, 600.0, 400.0 ],
		"openinpresentation" : 1,
		"default_fontsize" : 12.0,
		"default_fontname" : "Arial",
		"gridsize" : [ 8.0, 8.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"id" : "obj-1",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 80.0, 230.0, 22.0 ],
					"text" : "v8 mute-solo-control.js"
				}
			},
			{
				"box" : 				{
					"id" : "obj-2",
					"maxclass" : "inlet",
					"numinlets" : 0,
					"numoutlets" : 1,
					"patching_rect" : [ 20.0, 20.0, 30.0, 30.0 ],
					"comment" : "in: <trackNum> mute|solo toggle"
				}
			},
			{
				"box" : 				{
					"id" : "obj-4",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 260.0, 80.0, 300.0, 20.0 ],
					"text" : "Send: 1 mute toggle  /  1 solo toggle"
				}
			},
			{
				"box" : 				{
					"id" : "obj-5",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 260.0, 100.0, 300.0, 20.0 ],
					"text" : "Track index is 1-based (standard tracks only)"
				}
			}
		],
		"lines" : [ 			{
				"patchline" : 				{
					"source" : [ "obj-2", 0 ],
					"destination" : [ "obj-1", 0 ]
				}
			}
		]
	}
}
